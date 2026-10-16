import type { Response } from "express";
import type postgres from "postgres";
import type { z } from "zod";

import type {
  CreateLeaveRequestSchema,
  DecideLeaveRequestSchema,
  LeaveCalendar,
  LeaveCalendarQuerySchema,
  LeaveExportQuery,
  LeavePart,
  LeaveRequest,
  LeaveStatus
} from "../../contracts/production-leave.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { nullableText, toIso, toNullableIso, type QuerySql } from "../../lib/db-types.js";
import { publishToRoom } from "../../realtime/publisher.js";
import { enqueueProductionEvents, leaveEvent } from "./notifications.js";
import type { AccessContext } from "../access/access-context.js";
import { visibleUserSql } from "../access/test-accounts.js";
import { toUserRef, type UserRefJson } from "../work/mappers.js";
import { assertProductionMember, hasProductionRole, isProductionAdmin, productionRoom } from "./access.js";
import { assertFeature, hasFeature } from "./features.js";
import { sendLeaveAttendanceWorkbook } from "./leave-export.js";
import {
  assertValidCalendarWindow,
  assertValidNewLeave,
  canCancelLeave,
  canDecideLeave,
  leaveDaysBetween,
  leaveSpanDays,
  type LeaveDayOptions
} from "./leave-rules.js";
import { businessDay, isValidDay } from "./time.js";

/**
 * Shared leave calendar ("Lịch nghỉ", SPEC §6.3, PLAN §10). Any production member files requests
 * for themselves (the reason is optional again, PD-065); only the roles of the `leave_approval` feature decide and
 * export the payroll attendance workbook (PD-065; by default Quản trị, the superadmin always — PD-057); Leaders still
 * see pending requests, read-only; everyone sees approved leave (names and dates only).
 */

type In<T extends z.ZodTypeAny> = z.infer<T>;
const org = (context: AccessContext) => context.organization.id;
const overlapConstraint = "production_leave_requests_no_overlap";

type LeaveRow = {
  id: string;
  user_id: string;
  from_date: string;
  to_date: string;
  part: LeavePart;
  note: string | null;
  status: LeaveStatus;
  decided_at: Date | null;
  decision_note: string | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  owner: UserRefJson;
  decider: UserRefJson | null;
  team_id: string | null;
  team_name: string | null;
};

/** `decider`: the `leave_approval` feature (PD-065) — decides PENDING requests and sees them all with their details. */
type Viewer = { userId: string; admin: boolean; leader: boolean; decider: boolean; today: string };

const viewerOf = async (context: AccessContext, sql: QuerySql): Promise<Viewer> => ({
  userId: context.user.id,
  admin: isProductionAdmin(context),
  leader: hasProductionRole(context, "LEADER"),
  decider: await hasFeature(context, "leave_approval", sql),
  today: businessDay(new Date())
});

/** Inclusive day window as a half-day slot range (matches the generated `slot_range` column). */
const windowRange = (sql: QuerySql, from: string, to: string) =>
  sql`tsrange(${from}::date + time '00:00', (${to}::date + 1) + time '00:00', '[)')`;

const selectLeaves = (sql: QuerySql, organizationId: string, where: postgres.PendingQuery<postgres.Row[]>) => sql<LeaveRow[]>`
  SELECT lr.id, lr.user_id, to_char(lr.from_date, 'YYYY-MM-DD') AS from_date, to_char(lr.to_date, 'YYYY-MM-DD') AS to_date,
    lr.part, lr.note, lr.status, lr.decided_at, lr.decision_note, lr.cancelled_at, lr.created_at, lr.updated_at,
    json_build_object('id', au.id, 'display_name', au.display_name, 'email', au.email, 'avatar_url', au.avatar_url) AS owner,
    CASE WHEN du.id IS NULL THEN NULL
      ELSE json_build_object('id', du.id, 'display_name', du.display_name, 'email', du.email, 'avatar_url', du.avatar_url) END AS decider,
    tm.id AS team_id, tm.name AS team_name
  FROM production.leave_requests lr
  JOIN public.app_users au ON au.id = lr.user_id
  LEFT JOIN public.app_users du ON du.id = lr.decided_by
  LEFT JOIN production.member_profiles mp ON mp.organization_id = lr.organization_id AND mp.user_id = lr.user_id
  LEFT JOIN production.teams tm ON tm.organization_id = lr.organization_id AND tm.id = mp.team_id
  WHERE lr.organization_id = ${organizationId} AND ${where}
  ORDER BY lr.from_date, au.display_name, lr.created_at, lr.id
  LIMIT 5000
`;

/** Notes, decider and email are only shown to the owner, to LEADER/ADMIN (Leaders read-only, PD-057) and to approvers (PD-065). */
const toLeave = (row: LeaveRow, viewer: Viewer): LeaveRequest => {
  const own = row.user_id === viewer.userId;
  const details = own || viewer.admin || viewer.leader || viewer.decider;
  const owner = toUserRef(row.owner)!;
  return {
    id: row.id,
    user: details ? owner : { ...owner, email: null },
    team: row.team_id && row.team_name ? { id: row.team_id, name: row.team_name } : null,
    fromDate: row.from_date,
    toDate: row.to_date,
    part: row.part,
    days: leaveSpanDays({ fromDate: row.from_date, toDate: row.to_date, part: row.part }),
    note: details ? row.note : null,
    status: row.status,
    decidedBy: details ? toUserRef(row.decider) : null,
    decidedAt: toNullableIso(row.decided_at),
    decisionNote: details ? row.decision_note : null,
    cancelledAt: toNullableIso(row.cancelled_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    canCancel: canCancelLeave({ status: row.status, fromDate: row.from_date, own }, viewer),
    canDecide: canDecideLeave({ status: row.status }, viewer)
  };
};

const notFound = () => new AppError("LEAVE_NOT_FOUND", "Không tìm thấy đơn nghỉ.", 404);

const loadOne = async (sql: QuerySql, context: AccessContext, id: string) => {
  const row = (await selectLeaves(sql, org(context), sql`lr.id = ${id}`))[0];
  if (!row) {
    throw notFound();
  }
  return toLeave(row, await viewerOf(context, sql));
};

const publishLeaveChanged = (organizationId: string) => {
  publishToRoom(productionRoom(organizationId), "production:leave", { at: new Date().toISOString() });
};

const isOverlapViolation = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "23P01" &&
  "constraint_name" in error &&
  error.constraint_name === overlapConstraint;

// Reads -------------------------------------------------------------------------------------------

/**
 * Calendar window (≤ leaveLimits.maxCalendarDays, one year since PD-057): APPROVED requests of everyone, the
 * caller's own requests in any status, and (LEADER/ADMIN/approvers) every PENDING request — Leaders read-only. Temporary QA
 * test accounts' requests are left out for a viewer who is not one (PD-063), here, in the queue and in the export.
 */
export const getLeaveCalendar = async (context: AccessContext, query: In<typeof LeaveCalendarQuerySchema>): Promise<LeaveCalendar> => {
  assertProductionMember(context);
  assertValidCalendarWindow(query.from, query.to);
  const sql = getSql();
  const viewer = await viewerOf(context, sql);
  const seeAllPending = viewer.admin || viewer.leader || viewer.decider;
  const rows = await selectLeaves(
    sql,
    org(context),
    sql`(
      (lr.status IN ('PENDING', 'APPROVED') AND lr.slot_range && ${windowRange(sql, query.from, query.to)}
        AND (lr.status = 'APPROVED' OR lr.user_id = ${viewer.userId} OR ${seeAllPending}::boolean))
      OR (lr.user_id = ${viewer.userId} AND lr.from_date <= ${query.to}::date AND lr.to_date >= ${query.from}::date)
    ) AND (${query.teamId ?? null}::uuid IS NULL OR mp.team_id = ${query.teamId ?? null}::uuid)
      AND ${visibleUserSql(sql, context)}`
  );
  return { from: query.from, to: query.to, today: viewer.today, items: rows.map((row) => toLeave(row, viewer)) };
};

/** "Đơn của tôi": the caller's own requests in any status, newest leave first. */
export const listMyLeave = async (context: AccessContext) => {
  assertProductionMember(context);
  const sql = getSql();
  const viewer = await viewerOf(context, sql);
  const rows = await selectLeaves(sql, org(context), sql`lr.user_id = ${viewer.userId}`);
  return { items: rows.map((row) => toLeave(row, viewer)).reverse().slice(0, 200) };
};

/**
 * Pending queue: every PENDING request, oldest leave first. The approvers (`leave_approval`, PD-065) decide them;
 * LEADER and ADMIN keep seeing the queue (read-only without the feature: `canDecide` false, PD-057). Others 403.
 */
export const listPendingLeave = async (context: AccessContext) => {
  assertProductionMember(context);
  const sql = getSql();
  const viewer = await viewerOf(context, sql);
  if (!viewer.admin && !viewer.leader && !viewer.decider) {
    throw new AppError("FORBIDDEN", "Bạn không có quyền thực hiện thao tác này.", 403);
  }
  const rows = await selectLeaves(sql, org(context), sql`lr.status = 'PENDING' AND ${visibleUserSql(sql, context)}`);
  return { items: rows.map((row) => toLeave(row, viewer)) };
};

// Writes ------------------------------------------------------------------------------------------

/** Any production member files a PENDING request for themselves. Overlaps are rejected by the DB. */
export const createLeaveRequest = async (context: AccessContext, input: In<typeof CreateLeaveRequestSchema>) => {
  assertProductionMember(context);
  assertValidNewLeave(input, businessDay(new Date()));
  const sql = getSql();
  let id: string;
  try {
    id = (
      await sql<{ id: string }[]>`
        INSERT INTO production.leave_requests (organization_id, user_id, from_date, to_date, part, note)
        VALUES (${org(context)}, ${context.user.id}, ${input.fromDate}::date, ${input.toDate}::date, ${input.part}, ${nullableText(input.note) ?? null})
        RETURNING id
      `
    )[0]!.id;
  } catch (error) {
    if (isOverlapViolation(error)) {
      throw new AppError("LEAVE_OVERLAP", "Bạn đã có đơn nghỉ (đang chờ duyệt hoặc đã duyệt) trùng thời gian này.", 409);
    }
    throw error;
  }
  await enqueueProductionEvents(sql, [leaveEvent(org(context), "requested", id, context.user.id)]);
  publishLeaveChanged(org(context));
  return await loadOne(sql, context, id);
};

/**
 * PD-065: only the roles of the `leave_approval` feature (by default Quản trị; organization superadmins always) decide leave
 * requests (PD-057). Others 403 FORBIDDEN "Bạn không có quyền duyệt đơn nghỉ." (`details.feature`), non-members 404.
 */
export const assertLeaveDecider = async (context: AccessContext, sql: QuerySql = getSql()) =>
  await assertFeature(context, "leave_approval", { sql, message: "Bạn không có quyền duyệt đơn nghỉ." });

/** An approver decides a PENDING request (their own too — PD-057). */
export const decideLeaveRequest = async (context: AccessContext, id: string, input: In<typeof DecideLeaveRequestSchema>) => {
  const sql = getSql();
  await assertLeaveDecider(context, sql);
  await sql.begin(async (tx) => {
    const current = (
      await tx<{ status: LeaveStatus }[]>`
        SELECT status FROM production.leave_requests WHERE organization_id = ${org(context)} AND id = ${id} FOR UPDATE
      `
    )[0];
    if (!current) {
      throw notFound();
    }
    if (current.status !== "PENDING") {
      throw new AppError("LEAVE_NOT_PENDING", "Đơn nghỉ này đã được xử lý.", 409);
    }
    await tx`
      UPDATE production.leave_requests
      SET status = ${input.decision}, decided_by = ${context.user.id}, decided_at = now(), decision_note = ${nullableText(input.note) ?? null}
      WHERE organization_id = ${org(context)} AND id = ${id}
    `;
    await enqueueProductionEvents(tx, [leaveEvent(org(context), "decided", id, context.user.id)]);
  });
  publishLeaveChanged(org(context));
  return await loadOne(sql, context, id);
};

/** Owner or ADMIN cancels a PENDING/APPROVED request, only before it starts (PD-059). */
export const cancelLeaveRequest = async (context: AccessContext, id: string) => {
  assertProductionMember(context);
  const sql = getSql();
  const viewer = await viewerOf(context, sql);
  await sql.begin(async (tx) => {
    const current = (
      await tx<{ user_id: string; status: LeaveStatus; from_date: string }[]>`
        SELECT user_id, status, to_char(from_date, 'YYYY-MM-DD') AS from_date
        FROM production.leave_requests WHERE organization_id = ${org(context)} AND id = ${id} FOR UPDATE
      `
    )[0];
    if (!current) {
      throw notFound();
    }
    const own = current.user_id === viewer.userId;
    if (!own && !viewer.admin) {
      throw new AppError("FORBIDDEN", "Bạn chỉ có thể huỷ đơn nghỉ của chính mình.", 403);
    }
    if (!canCancelLeave({ status: current.status, fromDate: current.from_date, own }, viewer)) {
      throw current.status === "PENDING" || current.status === "APPROVED"
        ? new AppError("LEAVE_ALREADY_STARTED", "Đơn nghỉ đã diễn ra nên không thể huỷ — chỉ huỷ được đơn nghỉ từ ngày mai trở đi.", 409)
        : new AppError("LEAVE_NOT_CANCELLABLE", "Đơn nghỉ này đã bị từ chối hoặc đã huỷ.", 409);
    }
    await tx`
      UPDATE production.leave_requests
      SET status = 'CANCELLED', cancelled_by = ${viewer.userId}, cancelled_at = now()
      WHERE organization_id = ${org(context)} AND id = ${id}
    `;
  });
  publishLeaveChanged(org(context));
  return await loadOne(sql, context, id);
};

// Payroll attendance export (PD-057) ------------------------------------------------------------

/**
 * PD-065: only the roles of the `leave_approval` feature (by default Quản trị; organization superadmins always) export
 * (PD-057). Others 403 FORBIDDEN "Bạn không có quyền xuất bảng chấm công nghỉ phép.", non-members 404.
 */
export const assertLeaveExporter = async (context: AccessContext, sql: QuerySql = getSql()) =>
  await assertFeature(context, "leave_approval", { sql, message: "Bạn không có quyền xuất bảng chấm công nghỉ phép." });

type AttendanceMemberRow = { user_id: string; display_name: string; email: string | null; team_name: string | null };

/**
 * GET /production/leave/export — the attendance workbook of [from, to] (PD-057): every active member holding a
 * production role (of `teamId`'s team when given; anyone else with APPROVED leave in the window is added) × every
 * day from APPROVED requests, plus the APPROVED / PENDING / REJECTED requests overlapping the window. Everything is
 * loaded and the file built before anything is sent, so every failure is a JSON error.
 */
export const exportLeaveAttendance = async (context: AccessContext, res: Response, query: LeaveExportQuery) => {
  const sql = getSql();
  await assertLeaveExporter(context, sql);
  assertValidCalendarWindow(query.from, query.to, "xuất");
  const organizationId = org(context);
  const teamId = query.teamId ?? null;
  let teamName: string | null = null;
  if (teamId) {
    const team = (await sql<{ name: string }[]>`SELECT name FROM production.teams WHERE organization_id = ${organizationId} AND id = ${teamId}`)[0];
    if (!team) {
      throw new AppError("TEAM_NOT_FOUND", "Không tìm thấy team.", 404);
    }
    teamName = team.name;
  }
  const [members, rows] = await Promise.all([
    sql<AttendanceMemberRow[]>`
      SELECT au.id AS user_id, au.display_name, au.email, tm.name AS team_name
      FROM public.organization_memberships om
      JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
      LEFT JOIN production.member_profiles mp ON mp.organization_id = om.organization_id AND mp.user_id = om.user_id
      LEFT JOIN production.teams tm ON tm.organization_id = om.organization_id AND tm.id = mp.team_id
      WHERE om.organization_id = ${organizationId} AND om.deleted_at IS NULL AND om.status = 'active'
        AND EXISTS (SELECT 1 FROM production.user_roles ur WHERE ur.organization_id = om.organization_id AND ur.user_id = om.user_id)
        AND (${teamId}::uuid IS NULL OR mp.team_id = ${teamId}::uuid)
        AND ${visibleUserSql(sql, context)}
      ORDER BY au.display_name, au.id
      LIMIT 2000
    `,
    selectLeaves(
      sql,
      organizationId,
      sql`lr.status IN ('APPROVED', 'PENDING', 'REJECTED') AND lr.from_date <= ${query.to}::date AND lr.to_date >= ${query.from}::date
        AND (${teamId}::uuid IS NULL OR mp.team_id = ${teamId}::uuid) AND ${visibleUserSql(sql, context)}`
    )
  ]);
  await sendLeaveAttendanceWorkbook(res, {
    from: query.from,
    to: query.to,
    teamName,
    exportedAt: new Date(),
    exporterName: context.user.displayName,
    people: members.map((row) => ({ userId: row.user_id, displayName: row.display_name, email: row.email, teamName: row.team_name })),
    requests: rows.map((row) => {
      const owner = toUserRef(row.owner)!;
      return {
        userId: row.user_id,
        person: { userId: row.user_id, displayName: owner.displayName, email: owner.email, teamName: row.team_name },
        fromDate: row.from_date,
        toDate: row.to_date,
        part: row.part,
        status: row.status,
        note: row.note,
        deciderName: toUserRef(row.decider)?.displayName ?? null,
        decidedAt: row.decided_at,
        decisionNote: row.decision_note,
        createdAt: row.created_at
      };
    })
  });
};

// KPI pro-rata (settings.kpi_prorate_leave) -----------------------------------------------------

const approvedSpans = (sql: QuerySql, organizationId: string, userIds: string[], from: string, to: string) => sql<
  { user_id: string; from_date: string; to_date: string; part: LeavePart }[]
>`
  SELECT user_id, to_char(from_date, 'YYYY-MM-DD') AS from_date, to_char(to_date, 'YYYY-MM-DD') AS to_date, part
  FROM production.leave_requests
  WHERE organization_id = ${organizationId} AND user_id = ANY(${userIds}::uuid[]) AND status = 'APPROVED'
    AND slot_range && ${windowRange(sql, from, to)}
`;

const assertWindow = (from: string, to: string) => {
  if (!isValidDay(from) || !isValidDay(to)) {
    throw new RangeError("from/to must be YYYY-MM-DD calendar days");
  }
};

/**
 * APPROVED leave days of one user in the inclusive window [from, to] (half day = 0.5), for the KPI
 * forecast/settlement when settings.kpi_prorate_leave is on. Pass { workdaysOnly: true } to count
 * Monday–Saturday only (SPEC §6.3 pro-rata by working days).
 */
export const approvedLeaveDays = async (
  sql: QuerySql,
  organizationId: string,
  userId: string,
  from: string,
  to: string,
  options: LeaveDayOptions = {}
) => {
  assertWindow(from, to);
  if (to < from) {
    return 0;
  }
  const rows = await approvedSpans(sql, organizationId, [userId], from, to);
  return leaveDaysBetween(
    rows.map((row) => ({ fromDate: row.from_date, toDate: row.to_date, part: row.part })),
    from,
    to,
    options
  );
};

/** Same as approvedLeaveDays for many users at once (KPI settlement); users without leave map to 0. */
export const approvedLeaveDaysByUser = async (
  sql: QuerySql,
  organizationId: string,
  userIds: string[],
  from: string,
  to: string,
  options: LeaveDayOptions = {}
) => {
  assertWindow(from, to);
  const result = new Map<string, number>(userIds.map((userId) => [userId, 0]));
  if (userIds.length === 0 || to < from) {
    return result;
  }
  const rows = await approvedSpans(sql, organizationId, [...new Set(userIds)], from, to);
  const byUser = new Map<string, { fromDate: string; toDate: string; part: LeavePart }[]>();
  for (const row of rows) {
    const spans = byUser.get(row.user_id) ?? [];
    spans.push({ fromDate: row.from_date, toDate: row.to_date, part: row.part });
    byUser.set(row.user_id, spans);
  }
  for (const [userId, spans] of byUser) {
    result.set(userId, leaveDaysBetween(spans, from, to, options));
  }
  return result;
};

export { leaveDaysBetween, workdaysBetween, type LeaveDayOptions, type LeaveSpan } from "./leave-rules.js";
