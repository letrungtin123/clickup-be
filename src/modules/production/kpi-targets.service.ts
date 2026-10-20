import type { z } from "zod";

import { sortProductionRoles } from "../../contracts/production-catalog.js";
import {
  kpiRequiredRoles,
  type ApplyDefaultKpiResult,
  type KpiTarget,
  type KpiTargetCell,
  type KpiTargetImportRequestSchema,
  type KpiTargetImportResult,
  type KpiTargetMatrix,
  type KpiTargetsMissing,
  type PutKpiTargetsRequestSchema
} from "../../contracts/production-scores.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { toIso, type QuerySql, type SqlFragment } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { visibleUserIdSql, visibleUserSql } from "../access/test-accounts.js";
import { toUserRef, type UserRefJson } from "../work/mappers.js";
import { assertConfigEditor, assertProductionAdmin } from "./access.js";
import { closeDaysOf, loadSettings } from "./catalog.service.js";
import { isAlignedPeriod, parseKpiTargetCsv } from "./kpi-targets.js";
import { effectiveVersion, periodOfDay, type KpiPeriodType, type TargetVersion } from "./scoring.js";
import { businessDay } from "./time.js";

/**
 * KPI targets (ADMIN, SPEC Phase 3 §4–§5): versioned per user and period type — a version applies
 * from its effective_from period until the next one. Targets are configuration, not ledger rows:
 * a version for the same start is replaced, and a mistaken version can be deleted.
 */

type In<T extends z.ZodTypeAny> = z.infer<T>;
const org = (context: AccessContext) => context.organization.id;

type TargetRow = {
  id: string;
  user_id: string;
  period_type: KpiPeriodType;
  target_points: string;
  effective_from: string;
  note: string | null;
  updated_by: UserRefJson | null;
  created_at: Date;
  updated_at: Date;
};

const toTarget = (row: TargetRow): KpiTarget => ({
  id: row.id,
  userId: row.user_id,
  periodType: row.period_type,
  targetPoints: Number(row.target_points),
  effectiveFrom: row.effective_from,
  note: row.note,
  updatedBy: toUserRef(row.updated_by),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at)
});

const selectTargets = (sql: QuerySql, organizationId: string, filter: { ids?: string[]; until?: string; visible?: SqlFragment }) => sql<TargetRow[]>`
  SELECT k.id, k.user_id, k.period_type, k.target_points::text AS target_points, to_char(k.effective_from, 'YYYY-MM') AS effective_from,
    k.note, k.created_at, k.updated_at,
    CASE WHEN u.id IS NULL THEN NULL
      ELSE json_build_object('id', u.id, 'display_name', u.display_name, 'email', u.email, 'avatar_url', u.avatar_url) END AS updated_by
  FROM production.kpi_targets k
  LEFT JOIN public.app_users u ON u.id = coalesce(k.updated_by, k.created_by)
  WHERE k.organization_id = ${organizationId}
    ${filter.ids ? sql`AND k.id = ANY(${filter.ids}::uuid[])` : sql``}
    ${filter.until ? sql`AND k.effective_from <= ${filter.until}::date` : sql``}
    ${filter.visible ? sql`AND ${filter.visible}` : sql``}
  ORDER BY k.user_id, k.period_type, k.effective_from DESC
  LIMIT 20000
`;

/**
 * Every target version of `userIds` (of the given period types), per user — one query for many people (KPI settlement,
 * KPI report, the board's KPI column). Pick a period's target with scoring.ts effectiveTarget.
 */
export const loadTargetVersionsByUser = async (sql: QuerySql, organizationId: string, userIds: string[], types: KpiPeriodType[]) => {
  const byUser = new Map<string, TargetVersion[]>();
  if (userIds.length === 0) {
    return byUser;
  }
  const rows = await sql<{ user_id: string; period_type: KpiPeriodType; target_points: string; effective_from: string }[]>`
    SELECT user_id, period_type, target_points::text AS target_points, to_char(effective_from, 'YYYY-MM') AS effective_from
    FROM production.kpi_targets
    WHERE organization_id = ${organizationId} AND user_id = ANY(${userIds}::uuid[]) AND period_type = ANY(${types}::text[])
  `;
  for (const row of rows) {
    byUser.set(row.user_id, [
      ...(byUser.get(row.user_id) ?? []),
      { periodType: row.period_type, targetPoints: Number(row.target_points), effectiveFrom: row.effective_from }
    ]);
  }
  return byUser;
};

const assertAligned = (periodType: KpiPeriodType, period: string) => {
  if (!isAlignedPeriod(periodType, period)) {
    throw new AppError("KPI_PERIOD_INVALID", "KPI quý phải bắt đầu từ kỳ tháng 1, 4, 7 hoặc 10; KPI năm từ kỳ tháng 1.", 400);
  }
};

type UpsertItem = { userId: string; periodType: KpiPeriodType; effectiveFrom: string; targetPoints: number; note: string | null };

const upsertTargets = async (sql: QuerySql, organizationId: string, items: UpsertItem[], actorId: string) => {
  const ids: string[] = [];
  for (const item of items) {
    const row = (
      await sql<{ id: string }[]>`
        INSERT INTO production.kpi_targets (organization_id, user_id, period_type, target_points, effective_from, note, created_by, updated_by)
        VALUES (${organizationId}, ${item.userId}, ${item.periodType}, ${item.targetPoints}, ${`${item.effectiveFrom}-01`}::date,
                ${item.note}, ${actorId}, ${actorId})
        ON CONFLICT (organization_id, user_id, period_type, effective_from)
        DO UPDATE SET target_points = EXCLUDED.target_points, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by
        RETURNING id
      `
    )[0]!;
    ids.push(row.id);
  }
  return ids;
};

// Matrix ---------------------------------------------------------------------------------------------------

type MemberRow = UserRefJson & { team_id: string | null; roles: string[] | null };

/**
 * GET /production/kpi-targets?year — production members × the 12 monthly periods (+ quarters, year) and history.
 * Temporary QA test accounts (and their targets) are left out for a viewer who is not one (PD-063).
 */
export const getKpiTargetMatrix = async (context: AccessContext, query: { year?: number | undefined }): Promise<KpiTargetMatrix> => {
  assertProductionAdmin(context);
  const sql = getSql();
  const organizationId = org(context);
  const settings = await loadSettings(sql, organizationId);
  const year = query.year ?? Number(periodOfDay(businessDay(new Date()), closeDaysOf(settings)).slice(0, 4));
  const periods = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);

  const [members, targetRows] = await Promise.all([
    sql<MemberRow[]>`
      SELECT au.id, au.display_name, au.email, au.avatar_url, mp.team_id,
        (SELECT array_agg(ur.role_code ORDER BY ur.role_code) FROM production.user_roles ur
          WHERE ur.organization_id = om.organization_id AND ur.user_id = au.id) AS roles
      FROM public.organization_memberships om
      JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
      LEFT JOIN production.member_profiles mp ON mp.organization_id = om.organization_id AND mp.user_id = au.id
      WHERE om.organization_id = ${organizationId} AND om.deleted_at IS NULL AND om.status = 'active'
        AND (EXISTS (SELECT 1 FROM production.user_roles ur WHERE ur.organization_id = om.organization_id AND ur.user_id = au.id)
          OR EXISTS (SELECT 1 FROM production.kpi_targets k WHERE k.organization_id = om.organization_id AND k.user_id = au.id))
        AND ${visibleUserSql(sql, context)}
      ORDER BY au.display_name, au.id
      LIMIT 2000
    `,
    selectTargets(sql, organizationId, { until: `${year}-12-01`, visible: visibleUserIdSql(sql, context, sql`k.user_id`) })
  ]);

  const history = targetRows.map(toTarget);
  const byUser = new Map<string, KpiTarget[]>();
  for (const target of history) {
    byUser.set(target.userId, [...(byUser.get(target.userId) ?? []), target]);
  }
  const cell = (versions: KpiTarget[], periodType: KpiPeriodType, period: string): KpiTargetCell => {
    const version = effectiveVersion(versions, periodType, period);
    return {
      period,
      targetPoints: version?.targetPoints ?? null,
      targetId: version?.id ?? null,
      effectiveFrom: version?.effectiveFrom ?? null,
      explicit: version?.effectiveFrom === period
    };
  };

  return {
    year,
    periods,
    rows: members.map((member) => {
      const versions = byUser.get(member.id) ?? [];
      return {
        user: toUserRef(member)!,
        teamId: member.team_id,
        roles: member.roles ?? [],
        months: periods.map((period) => cell(versions, "MONTH", period)),
        quarters: ["01", "04", "07", "10"].map((month) => cell(versions, "QUARTER", `${year}-${month}`)),
        year: cell(versions, "YEAR", `${year}-01`)
      };
    }),
    history
  };
};

// PD-066: KPI is mandatory -------------------------------------------------------------------------------------

type RequiredMemberRow = UserRefJson & { team_id: string | null; team_name: string | null; roles: string[] | null; has_target: boolean };

/**
 * PD-066: the people who must have a MONTH KPI for `period` — active members of the organization holding one of
 * `kpiRequiredRoles` (ADMIN, ACCOUNT, LEADER, QC, STAFF), except the organization superadmin, members who are only
 * DIRECTOR and temporary QA test accounts (whoever looks) — each with whether a MONTH target is effective for the period
 * (a version starting at or before it). `onlyUserId`: just that person (empty when they need none).
 */
const selectKpiRequiredMembers = (sql: QuerySql, organizationId: string, period: string, onlyUserId: string | null = null) => sql<RequiredMemberRow[]>`
  SELECT au.id, au.display_name, au.email, au.avatar_url, mp.team_id, tm.name AS team_name,
    (SELECT array_agg(ur.role_code) FROM production.user_roles ur WHERE ur.organization_id = om.organization_id AND ur.user_id = om.user_id) AS roles,
    EXISTS (
      SELECT 1 FROM production.kpi_targets k
      WHERE k.organization_id = om.organization_id AND k.user_id = om.user_id AND k.period_type = 'MONTH'
        AND k.effective_from <= ${`${period}-01`}::date
    ) AS has_target
  FROM public.organization_memberships om
  JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL AND NOT au.is_test_account
  LEFT JOIN production.member_profiles mp ON mp.organization_id = om.organization_id AND mp.user_id = om.user_id
  LEFT JOIN production.teams tm ON tm.organization_id = om.organization_id AND tm.id = mp.team_id
  WHERE om.organization_id = ${organizationId} AND om.deleted_at IS NULL AND om.status = 'active'
    AND EXISTS (
      SELECT 1 FROM production.user_roles ur
      WHERE ur.organization_id = om.organization_id AND ur.user_id = om.user_id AND ur.role_code = ANY(${[...kpiRequiredRoles]}::text[])
    )
    AND NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.id = om.role_id AND r.key = 'superadmin')
    AND (${onlyUserId}::uuid IS NULL OR om.user_id = ${onlyUserId}::uuid)
  ORDER BY au.display_name, au.id
  LIMIT 5000
`;

/** PD-066: who must have a MONTH KPI for `period` (`requiredCount`) and who of them has none (`missing`, by name). */
export const findMissingKpiTargets = async (sql: QuerySql, organizationId: string, period: string) => {
  const rows = await selectKpiRequiredMembers(sql, organizationId, period);
  return { requiredCount: rows.length, missing: rows.filter((row) => !row.has_target) };
};

/** PD-066: the ids of everyone who must have a MONTH KPI for `period` (see selectKpiRequiredMembers) — one query. */
export const loadKpiRequiredUserIds = async (sql: QuerySql, organizationId: string, period: string) =>
  new Set((await selectKpiRequiredMembers(sql, organizationId, period)).map((row) => row.id));

/** PD-066: `userId` must have a MONTH KPI (see selectKpiRequiredMembers); the period only decides `hasTarget`. */
export const loadKpiRequirement = async (sql: QuerySql, organizationId: string, userId: string, period: string) => {
  const [row] = await selectKpiRequiredMembers(sql, organizationId, period, userId);
  return { required: row !== undefined, hasTarget: row?.has_target ?? false };
};

/** 409 KPI_TARGETS_MISSING of a settlement run (details: KpiTargetsMissingDetailsSchema). Nothing may be written. */
export const kpiTargetsMissingError = (missing: readonly Pick<RequiredMemberRow, "id" | "display_name">[]) =>
  new AppError("KPI_TARGETS_MISSING", `Còn ${missing.length} người chưa có KPI kỳ này — set KPI trước khi chốt.`, 409, {
    users: missing.map((row) => ({ id: row.id, displayName: row.display_name }))
  });

/**
 * GET /production/kpi-targets/missing?period — PD-066: who must have a MONTH KPI for the period (default: the current
 * one) and has none, for the people who manage KPI (ADMIN, like the KPI matrix). Settling that period is refused (409
 * KPI_TARGETS_MISSING) until the list is empty.
 */
export const getMissingKpiTargets = async (context: AccessContext, query: { period?: string | undefined }): Promise<KpiTargetsMissing> => {
  assertProductionAdmin(context);
  const sql = getSql();
  const organizationId = org(context);
  const period = query.period ?? periodOfDay(businessDay(new Date()), closeDaysOf(await loadSettings(sql, organizationId)));
  const { requiredCount, missing } = await findMissingKpiTargets(sql, organizationId, period);
  return {
    period,
    requiredCount,
    items: missing.map((row) => ({
      user: toUserRef(row)!,
      teamId: row.team_id,
      teamName: row.team_name,
      roles: sortProductionRoles(row.roles ?? [])
    }))
  };
};

// Writes -----------------------------------------------------------------------------------------------------

const memberIds = async (sql: QuerySql, organizationId: string, userIds: string[]) =>
  new Set(
    (
      await sql<{ user_id: string }[]>`
        SELECT user_id FROM public.organization_memberships
        WHERE organization_id = ${organizationId} AND deleted_at IS NULL AND user_id = ANY(${userIds}::uuid[])
      `
    ).map((row) => row.user_id)
  );

/** PUT /production/kpi-targets — sets versions (same user/type/start replaces it). */
export const putKpiTargets = async (context: AccessContext, input: In<typeof PutKpiTargetsRequestSchema>) => {
  assertConfigEditor(context);
  const organizationId = org(context);
  const items = new Map<string, UpsertItem>();
  for (const item of input.items) {
    assertAligned(item.periodType, item.effectiveFrom);
    items.set(`${item.userId}|${item.periodType}|${item.effectiveFrom}`, { ...item, note: item.note?.trim() || null });
  }
  const sql = getSql();
  const ids = await sql.begin(async (tx) => {
    const members = await memberIds(tx, organizationId, [...new Set([...items.values()].map((item) => item.userId))]);
    if ([...items.values()].some((item) => !members.has(item.userId))) {
      throw new AppError("MEMBER_NOT_FOUND", "Không tìm thấy thành viên.", 404);
    }
    return await upsertTargets(tx, organizationId, [...items.values()], context.user.id);
  });
  return { items: (await selectTargets(sql, organizationId, { ids })).map(toTarget) };
};

/** DELETE /production/kpi-targets/:id — removes one version (the previous one applies again). */
export const deleteKpiTarget = async (context: AccessContext, targetId: string) => {
  assertConfigEditor(context);
  const rows = await getSql()`DELETE FROM production.kpi_targets WHERE organization_id = ${org(context)} AND id = ${targetId} RETURNING id`;
  if (rows.length === 0) {
    throw new AppError("KPI_TARGET_NOT_FOUND", "Không tìm thấy KPI.", 404);
  }
  return { ok: true as const };
};

/**
 * POST /production/kpi-targets/import — CSV user_email,target for one period. All-or-nothing: any bad
 * line (format, duplicate, unknown member) is reported with its line number and nothing is written.
 * Unknown emails are reported together with the format errors of the same file (PR-25), line by line.
 */
export const importKpiTargets = async (context: AccessContext, input: In<typeof KpiTargetImportRequestSchema>): Promise<KpiTargetImportResult> => {
  assertConfigEditor(context);
  assertAligned(input.periodType, input.period);
  const organizationId = org(context);
  const { rows, errors } = parseKpiTargetCsv(input.csv);
  const sql = getSql();
  const emails = rows.map((row) => row.email);
  const users = new Map(
    emails.length === 0
      ? []
      : (
          await sql<{ email: string; id: string }[]>`
            SELECT lower(au.email) AS email, au.id FROM public.app_users au
            JOIN public.organization_memberships om ON om.user_id = au.id AND om.organization_id = ${organizationId} AND om.deleted_at IS NULL
            WHERE au.deleted_at IS NULL AND lower(au.email) = ANY(${emails}::text[])
          `
        ).map((row) => [row.email, row.id])
  );
  for (const row of rows) {
    if (!users.has(row.email)) {
      errors.push({ line: row.line, message: `Không tìm thấy thành viên có email "${row.email}".` });
    }
  }
  if (errors.length > 0) {
    return { ok: false, imported: 0, errors: errors.sort((a, b) => a.line - b.line) };
  }
  await sql.begin(async (tx) => {
    await upsertTargets(
      tx,
      organizationId,
      rows.map((row) => ({ userId: users.get(row.email)!, periodType: input.periodType, effectiveFrom: input.period, targetPoints: row.target, note: null })),
      context.user.id
    );
  });
  return { ok: true, imported: rows.length, errors: [] };
};

/**
 * POST /production/kpi-targets/apply-defaults — "Áp KPI mặc định theo role": every active member holding
 * STAFF, LEADER or QC without a MONTH target effective for the period gets one starting at that period:
 * settings.kpiDefaultLeader for LEADERs, settings.kpiDefaultMember otherwise. A real caller never touches temporary QA
 * test accounts (PD-063).
 */
export const applyDefaultKpiTargets = async (context: AccessContext, period: string): Promise<ApplyDefaultKpiResult> => {
  assertConfigEditor(context);
  const organizationId = org(context);
  const sql = getSql();
  const settings = await loadSettings(sql, organizationId);
  return await sql.begin(async (tx) => {
    const candidates = await tx<{ user_id: string; is_leader: boolean; has_target: boolean }[]>`
      SELECT om.user_id, bool_or(ur.role_code = 'LEADER') AS is_leader,
        EXISTS (
          SELECT 1 FROM production.kpi_targets k
          WHERE k.organization_id = om.organization_id AND k.user_id = om.user_id AND k.period_type = 'MONTH'
            AND k.effective_from <= ${`${period}-01`}::date
        ) AS has_target
      FROM public.organization_memberships om
      JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
      JOIN production.user_roles ur ON ur.organization_id = om.organization_id AND ur.user_id = om.user_id
        AND ur.role_code IN ('STAFF', 'LEADER', 'QC')
      WHERE om.organization_id = ${organizationId} AND om.deleted_at IS NULL AND om.status = 'active'
        AND ${visibleUserSql(tx, context)}
      GROUP BY om.organization_id, om.user_id
    `;
    const items: { userId: string; targetPoints: number }[] = [];
    for (const candidate of candidates.filter((row) => !row.has_target)) {
      const targetPoints = candidate.is_leader ? settings.kpiDefaultLeader : settings.kpiDefaultMember;
      const created = await tx<{ id: string }[]>`
        INSERT INTO production.kpi_targets (organization_id, user_id, period_type, target_points, effective_from, note, created_by, updated_by)
        VALUES (${organizationId}, ${candidate.user_id}, 'MONTH', ${targetPoints}, ${`${period}-01`}::date, 'KPI mặc định theo role',
                ${context.user.id}, ${context.user.id})
        ON CONFLICT (organization_id, user_id, period_type, effective_from) DO NOTHING
        RETURNING id
      `;
      if (created.length > 0) {
        items.push({ userId: candidate.user_id, targetPoints });
      }
    }
    return { period, created: items.length, skipped: candidates.length - items.length, items };
  });
};
