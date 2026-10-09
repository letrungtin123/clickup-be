import type postgres from "postgres";
import type { z } from "zod";

import type {
  CreateLeaveRequestSchema,
  DecideLeaveRequestSchema,
  LeaveCalendar,
  LeaveCalendarQuerySchema,
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
import { toUserRef, type UserRefJson } from "../work/mappers.js";
import { assertProductionMember, assertProductionRole, hasProductionRole, isProductionAdmin, productionRoom } from "./access.js";
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
 * for themselves; LEADER/ADMIN decide; everyone sees approved leave (names and dates only).
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

type Viewer = { userId: string; admin: boolean; leader: boolean; today: string };

const viewerOf = (context: AccessContext): Viewer => ({
  userId: context.user.id,
  admin: isProductionAdmin(context),
  leader: hasProductionRole(context, "LEADER"),
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

/** Notes, decider and email are only shown to the owner and to LEADER/ADMIN. */
const toLeave = (row: LeaveRow, viewer: Viewer): LeaveRequest => {
  const own = row.user_id === viewer.userId;
  const details = own || viewer.admin || viewer.leader;
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
    canDecide: canDecideLeave({ status: row.status, own }, viewer)
  };
};

const notFound = () => new AppError("LEAVE_NOT_FOUND", "Không tìm thấy đơn nghỉ.", 404);

const loadOne = async (sql: QuerySql, context: AccessContext, id: string) => {
  const row = (await selectLeaves(sql, org(context), sql`lr.id = ${id}`))[0];
  if (!row) {
    throw notFound();
  }
  return toLeave(row, viewerOf(context));
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
 * Calendar window: APPROVED requests of everyone, the caller's own requests in any status, and
 * (LEADER/ADMIN) every PENDING request.
 */
export const getLeaveCalendar = async (context: AccessContext, query: In<typeof LeaveCalendarQuerySchema>): Promise<LeaveCalendar> => {
  assertProductionMember(context);
  assertValidCalendarWindow(query.from, query.to);
  const viewer = viewerOf(context);
  const seeAllPending = viewer.admin || viewer.leader;
  const sql = getSql();
  const rows = await selectLeaves(
    sql,
    org(context),
    sql`(
      (lr.status IN ('PENDING', 'APPROVED') AND lr.slot_range && ${windowRange(sql, query.from, query.to)}
        AND (lr.status = 'APPROVED' OR lr.user_id = ${viewer.userId} OR ${seeAllPending}::boolean))
      OR (lr.user_id = ${viewer.userId} AND lr.from_date <= ${query.to}::date AND lr.to_date >= ${query.from}::date)
    ) AND (${query.teamId ?? null}::uuid IS NULL OR mp.team_id = ${query.teamId ?? null}::uuid)`
  );
  return { from: query.from, to: query.to, today: viewer.today, items: rows.map((row) => toLeave(row, viewer)) };
};

/** "Đơn của tôi": the caller's own requests in any status, newest leave first. */
export const listMyLeave = async (context: AccessContext) => {
  assertProductionMember(context);
  const viewer = viewerOf(context);
  const sql = getSql();
  const rows = await selectLeaves(sql, org(context), sql`lr.user_id = ${viewer.userId}`);
  return { items: rows.map((row) => toLeave(row, viewer)).reverse().slice(0, 200) };
};

/** Approval queue (LEADER/ADMIN): every PENDING request, oldest leave first. */
export const listPendingLeave = async (context: AccessContext) => {
  assertProductionRole(context, "LEADER");
  const viewer = viewerOf(context);
  const sql = getSql();
  const rows = await selectLeaves(sql, org(context), sql`lr.status = 'PENDING'`);
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

/** LEADER/ADMIN approve or reject a PENDING request; a LEADER cannot decide their own. */
export const decideLeaveRequest = async (context: AccessContext, id: string, input: In<typeof DecideLeaveRequestSchema>) => {
  assertProductionRole(context, "LEADER");
  const admin = isProductionAdmin(context);
  const sql = getSql();
  await sql.begin(async (tx) => {
    const current = (
      await tx<{ user_id: string; status: LeaveStatus }[]>`
        SELECT user_id, status FROM production.leave_requests WHERE organization_id = ${org(context)} AND id = ${id} FOR UPDATE
      `
    )[0];
    if (!current) {
      throw notFound();
    }
    if (current.user_id === context.user.id && !admin) {
      throw new AppError("LEAVE_SELF_DECISION", "Bạn không thể tự duyệt đơn nghỉ của chính mình.", 403);
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

/** Owner cancels a PENDING/APPROVED request before it starts; ADMIN may cancel anytime. */
export const cancelLeaveRequest = async (context: AccessContext, id: string) => {
  assertProductionMember(context);
  const viewer = viewerOf(context);
  const sql = getSql();
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
        ? new AppError("LEAVE_ALREADY_STARTED", "Đơn nghỉ đã bắt đầu nên không thể tự huỷ. Vui lòng liên hệ Quản trị.", 409)
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
