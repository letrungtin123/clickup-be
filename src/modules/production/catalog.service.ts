import type { z } from "zod";

import type {
  CreditImportRequestSchema,
  CreditImportResult,
  CustomValues,
  SetCreditRuleRequestSchema,
  ProductionMe,
  ProductionRole,
  ProductionSettings,
  UpdateProductionMemberRequestSchema,
  UpsertClientRequestSchema,
  UpsertCustomFieldRequestSchema,
  UpsertProcessRequestSchema,
  UpsertProductionProjectRequestSchema,
  UpsertShiftRequestSchema,
  UpsertStatusRequestSchema,
  UpsertTagRequestSchema,
  UpsertTeamRequestSchema,
  ReplaceTransitionsRequestSchema,
  UpdateProductionSettingsRequestSchema
} from "../../contracts/production-catalog.js";
import { productionRoleCodes } from "../../contracts/production-catalog.js";
import { getSql } from "../../db/client.js";
import { AppError } from "../../lib/app-error.js";
import { toIso, type QuerySql } from "../../lib/db-types.js";
import { invalidateAccessContexts, type AccessContext } from "../access/access-context.js";
import { toColor } from "../work/mappers.js";
import { assertProductionAdmin, assertProductionMember, assertProductionRole, isProductionAdmin, productionRolesOf } from "./access.js";
import { importCreditRules, listRuleHistory, listRulesAt, setCreditRule, startNewVersion } from "./credit-rules.js";
import { resolveCustomValues, setEntityTags } from "./custom-fields.js";
import { businessDay, isValidDay } from "./time.js";

type In<T extends z.ZodTypeAny> = z.infer<T>;
const org = (context: AccessContext) => context.organization.id;

// Settings ----------------------------------------------------------------------------------------

const settingKeys: Record<keyof ProductionSettings, string> = {
  kpiCloseDay: "kpi_close_day",
  scoresPublic: "scores_public",
  moneyPublic: "money_public",
  kpiProrateLeave: "kpi_prorate_leave",
  anomalyFailRate: "anomaly_fail_rate",
  dueSoonHours: "due_soon_hours",
  kpiDefaultMember: "kpi_default_member",
  kpiDefaultLeader: "kpi_default_leader",
  chatAttachmentsEnabled: "chat_attachments_enabled",
  timezone: "timezone"
};

const defaults: ProductionSettings = {
  kpiCloseDay: 25,
  scoresPublic: true,
  moneyPublic: false,
  kpiProrateLeave: false,
  anomalyFailRate: 0.15,
  dueSoonHours: 2,
  kpiDefaultMember: 2600,
  kpiDefaultLeader: 1848,
  chatAttachmentsEnabled: true,
  timezone: "Asia/Ho_Chi_Minh"
};

export const loadSettings = async (sql: QuerySql, organizationId: string): Promise<ProductionSettings> => {
  const rows = await sql<{ key: string; value: unknown }[]>`
    SELECT key, value FROM production.settings WHERE organization_id = ${organizationId}
  `;
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const result = { ...defaults } as Record<string, unknown>;
  for (const [field, key] of Object.entries(settingKeys)) {
    if (byKey.has(key)) {
      result[field] = byKey.get(key);
    }
  }
  return result as ProductionSettings;
};

export const getSettings = async (context: AccessContext) => {
  assertProductionAdmin(context);
  return await loadSettings(getSql(), org(context));
};

export const updateSettings = async (context: AccessContext, input: In<typeof UpdateProductionSettingsRequestSchema>) => {
  assertProductionAdmin(context);
  const sql = getSql();
  await sql.begin(async (tx) => {
    for (const [field, value] of Object.entries(input)) {
      if (value === undefined) {
        continue;
      }
      const key = settingKeys[field as keyof ProductionSettings];
      await tx`
        INSERT INTO production.settings (organization_id, key, value, updated_by)
        VALUES (${org(context)}, ${key}, ${tx.json(value)}, ${context.user.id})
        ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
      `;
    }
  });
  return await loadSettings(sql, org(context));
};

export const getProductionMe = async (context: AccessContext): Promise<ProductionMe> => {
  const sql = getSql();
  const roles = [...productionRolesOf(context)].sort(
    (a, b) => productionRoleCodes.indexOf(a) - productionRoleCodes.indexOf(b)
  );
  const settings = await loadSettings(sql, org(context));
  const profile = (
    await sql<{ team_id: string | null }[]>`
      SELECT team_id FROM production.member_profiles WHERE organization_id = ${org(context)} AND user_id = ${context.user.id}
    `
  )[0];
  return {
    roles,
    isAdmin: isProductionAdmin(context),
    teamId: profile?.team_id ?? null,
    settings: {
      kpiCloseDay: settings.kpiCloseDay,
      scoresPublic: settings.scoresPublic,
      moneyPublic: settings.moneyPublic,
      chatAttachmentsEnabled: settings.chatAttachmentsEnabled,
      timezone: settings.timezone
    }
  };
};

// Members -----------------------------------------------------------------------------------------

type MemberRow = {
  user_id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  roles: string[] | null;
  team_id: string | null;
  status: string;
  custom_values: CustomValues | null;
  tag_ids: string[] | null;
};

const selectMembers = (sql: QuerySql, organizationId: string, onlyUserId: string | null) => sql<MemberRow[]>`
  SELECT au.id AS user_id, au.display_name, au.email, au.avatar_url, om.status,
    (SELECT array_agg(ur.role_code) FROM production.user_roles ur WHERE ur.organization_id = om.organization_id AND ur.user_id = au.id) AS roles,
    mp.team_id, mp.custom_values,
    (SELECT array_agg(et.tag_id) FROM production.entity_tags et
      WHERE et.organization_id = om.organization_id AND et.entity = 'USER' AND et.entity_id = au.id) AS tag_ids
  FROM public.organization_memberships om
  JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
  LEFT JOIN production.member_profiles mp ON mp.organization_id = om.organization_id AND mp.user_id = au.id
  WHERE om.organization_id = ${organizationId} AND om.deleted_at IS NULL
    AND (${onlyUserId}::uuid IS NULL OR au.id = ${onlyUserId}::uuid)
  ORDER BY au.display_name, au.id
  LIMIT 2000
`;

const toMember = (row: MemberRow) => ({
  userId: row.user_id,
  displayName: row.display_name,
  email: row.email,
  avatarUrl: row.avatar_url,
  roles: (row.roles ?? []).filter((role): role is ProductionRole => (productionRoleCodes as readonly string[]).includes(role)),
  teamId: row.team_id,
  active: row.status === "active",
  customValues: row.custom_values ?? {},
  tagIds: row.tag_ids ?? []
});

/** Admins manage everyone; Leaders/Accounts need the list to assign work and pick QC. */
export const listMembers = async (context: AccessContext) => {
  assertProductionRole(context, "LEADER", "ACCOUNT", "QC");
  const rows = await selectMembers(getSql(), org(context), null);
  const admin = isProductionAdmin(context);
  return {
    items: rows
      .map(toMember)
      .filter((member) => admin || member.roles.length > 0)
      .map((member) => (admin ? member : { ...member, customValues: {}, tagIds: [] }))
  };
};

export const updateMember = async (context: AccessContext, userId: string, input: In<typeof UpdateProductionMemberRequestSchema>) => {
  assertProductionAdmin(context);
  const sql = getSql();
  await sql.begin(async (tx) => {
    const current = (await selectMembers(tx, org(context), userId))[0];
    if (!current) {
      throw new AppError("MEMBER_NOT_FOUND", "Không tìm thấy thành viên.", 404);
    }
    if (input.roles) {
      const roles = [...new Set(input.roles)];
      // The organization must keep at least one production ADMIN besides superadmins' implicit role.
      if (userId === context.user.id && !roles.includes("ADMIN") && !context.hasFullOrganizationAuthority) {
        throw new AppError("SELF_ADMIN_REMOVAL", "Bạn không thể tự bỏ quyền Quản trị của mình.", 409);
      }
      await tx`DELETE FROM production.user_roles WHERE organization_id = ${org(context)} AND user_id = ${userId} AND NOT (role_code = ANY(${roles}::text[]))`;
      if (roles.length > 0) {
        await tx`
          INSERT INTO production.user_roles (organization_id, user_id, role_code, granted_by)
          SELECT ${org(context)}, ${userId}, role, ${context.user.id} FROM unnest(${roles}::text[]) AS role
          ON CONFLICT DO NOTHING
        `;
      }
    }
    if (input.teamId !== undefined || input.customValues !== undefined) {
      if (input.teamId) {
        const team = await tx`SELECT 1 FROM production.teams WHERE organization_id = ${org(context)} AND id = ${input.teamId}`;
        if (team.length === 0) {
          throw new AppError("TEAM_NOT_FOUND", "Không tìm thấy team.", 404);
        }
      }
      const customValues =
        input.customValues !== undefined
          ? await resolveCustomValues(tx, org(context), "USER", input.customValues, { existing: current.custom_values ?? {}, enforceRequired: false })
          : (current.custom_values ?? {});
      await tx`
        INSERT INTO production.member_profiles (organization_id, user_id, team_id, custom_values)
        VALUES (${org(context)}, ${userId}, ${input.teamId !== undefined ? input.teamId : current.team_id}, ${tx.json(customValues)})
        ON CONFLICT (organization_id, user_id) DO UPDATE
          SET team_id = EXCLUDED.team_id, custom_values = EXCLUDED.custom_values, updated_at = now()
      `;
    }
    if (input.tagIds) {
      await setEntityTags(tx, org(context), "USER", userId, input.tagIds);
    }
  });
  if (input.roles) {
    await invalidateAccessContexts();
  }
  return toMember((await selectMembers(sql, org(context), userId))[0]!);
};

// Teams -------------------------------------------------------------------------------------------

export const listTeams = async (context: AccessContext) => {
  assertProductionMember(context);
  const rows = await getSql()<{ id: string; name: string; active: boolean; member_count: number }[]>`
    SELECT t.id, t.name, t.active,
      (SELECT count(*)::int FROM production.member_profiles mp WHERE mp.organization_id = t.organization_id AND mp.team_id = t.id) AS member_count
    FROM production.teams t WHERE t.organization_id = ${org(context)} ORDER BY t.active DESC, t.name
  `;
  return { items: rows.map((row) => ({ id: row.id, name: row.name, active: row.active, memberCount: row.member_count })) };
};

export const upsertTeam = async (context: AccessContext, id: string | null, input: In<typeof UpsertTeamRequestSchema>) => {
  assertProductionAdmin(context);
  const sql = getSql();
  if (id) {
    const rows = await sql`
      UPDATE production.teams SET name = ${input.name}, active = coalesce(${input.active ?? null}, active)
      WHERE organization_id = ${org(context)} AND id = ${id} RETURNING id
    `;
    if (rows.length === 0) {
      throw new AppError("TEAM_NOT_FOUND", "Không tìm thấy team.", 404);
    }
  } else {
    await sql`INSERT INTO production.teams (organization_id, name) VALUES (${org(context)}, ${input.name})`;
  }
  return await listTeams(context);
};

// Clients -----------------------------------------------------------------------------------------

type ClientRow = { id: string; name: string; note: string | null; active: boolean; custom_values: CustomValues; tag_ids: string[] | null; project_count: number };

export const listClients = async (context: AccessContext) => {
  assertProductionRole(context, "ACCOUNT", "LEADER");
  const rows = await getSql()<ClientRow[]>`
    SELECT c.id, c.name, c.note, c.active, c.custom_values,
      (SELECT array_agg(et.tag_id) FROM production.entity_tags et WHERE et.organization_id = c.organization_id AND et.entity = 'CLIENT' AND et.entity_id = c.id) AS tag_ids,
      (SELECT count(*)::int FROM production.projects p WHERE p.organization_id = c.organization_id AND p.client_id = c.id) AS project_count
    FROM production.clients c WHERE c.organization_id = ${org(context)}
    ORDER BY c.active DESC, c.name LIMIT 2000
  `;
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      note: row.note,
      active: row.active,
      customValues: row.custom_values,
      tagIds: row.tag_ids ?? [],
      projectCount: row.project_count
    }))
  };
};

/** PLAN §2: Account creates clients; Admin manages everything. */
export const upsertClient = async (context: AccessContext, id: string | null, input: In<typeof UpsertClientRequestSchema>) => {
  assertProductionRole(context, "ACCOUNT");
  const sql = getSql();
  await sql.begin(async (tx) => {
    const existing = id
      ? (await tx<{ custom_values: CustomValues }[]>`SELECT custom_values FROM production.clients WHERE organization_id = ${org(context)} AND id = ${id} FOR UPDATE`)[0]
      : undefined;
    if (id && !existing) {
      throw new AppError("CLIENT_NOT_FOUND", "Không tìm thấy client.", 404);
    }
    const customValues = await resolveCustomValues(tx, org(context), "CLIENT", input.customValues, {
      existing: existing?.custom_values ?? {},
      enforceRequired: true
    });
    const clientId = id
      ? (
          await tx<{ id: string }[]>`
            UPDATE production.clients
            SET name = ${input.name}, note = ${input.note ?? null}, active = coalesce(${input.active ?? null}, active), custom_values = ${tx.json(customValues)}
            WHERE organization_id = ${org(context)} AND id = ${id} RETURNING id
          `
        )[0]!.id
      : (
          await tx<{ id: string }[]>`
            INSERT INTO production.clients (organization_id, name, note, custom_values)
            VALUES (${org(context)}, ${input.name}, ${input.note ?? null}, ${tx.json(customValues)}) RETURNING id
          `
        )[0]!.id;
    if (input.tagIds) {
      await setEntityTags(tx, org(context), "CLIENT", clientId, input.tagIds);
    }
  });
  return await listClients(context);
};

// Projects ----------------------------------------------------------------------------------------

type ProjectRow = { id: string; code: string; name: string; client_id: string | null; client_name: string | null; qc_buffer_hours: number; active: boolean };
const toProject = (row: ProjectRow) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  clientId: row.client_id,
  clientName: row.client_name,
  qcBufferHours: row.qc_buffer_hours,
  active: row.active
});

export const selectProductionProjects = (sql: QuerySql, organizationId: string) => sql<ProjectRow[]>`
  SELECT p.id, p.code, p.name, p.client_id, c.name AS client_name, p.qc_buffer_hours, p.active
  FROM production.projects p
  LEFT JOIN production.clients c ON c.id = p.client_id AND c.organization_id = p.organization_id
  WHERE p.organization_id = ${organizationId}
  ORDER BY p.active DESC, upper(p.code)
  LIMIT 2000
`;

export const listProjects = async (context: AccessContext) => {
  assertProductionMember(context);
  return { items: (await selectProductionProjects(getSql(), org(context))).map(toProject) };
};

export const upsertProject = async (context: AccessContext, id: string | null, input: In<typeof UpsertProductionProjectRequestSchema>) => {
  assertProductionAdmin(context);
  const sql = getSql();
  if (input.clientId) {
    const client = await sql`SELECT 1 FROM production.clients WHERE organization_id = ${org(context)} AND id = ${input.clientId}`;
    if (client.length === 0) {
      throw new AppError("CLIENT_NOT_FOUND", "Không tìm thấy client.", 404);
    }
  }
  if (id) {
    const rows = await sql`
      UPDATE production.projects
      SET code = ${input.code}, name = ${input.name},
          client_id = CASE WHEN ${input.clientId !== undefined} THEN ${input.clientId ?? null}::uuid ELSE client_id END,
          qc_buffer_hours = coalesce(${input.qcBufferHours ?? null}, qc_buffer_hours),
          active = coalesce(${input.active ?? null}, active)
      WHERE organization_id = ${org(context)} AND id = ${id} RETURNING id
    `;
    if (rows.length === 0) {
      throw new AppError("PROJECT_NOT_FOUND", "Không tìm thấy dự án.", 404);
    }
  } else {
    await sql`
      INSERT INTO production.projects (organization_id, code, name, client_id, qc_buffer_hours)
      VALUES (${org(context)}, ${input.code}, ${input.name}, ${input.clientId ?? null}, ${input.qcBufferHours ?? 0})
    `;
  }
  return await listProjects(context);
};

// Processes & shifts ------------------------------------------------------------------------------

export const listProcesses = async (context: AccessContext) => {
  assertProductionMember(context);
  const rows = await getSql()<{ id: string; name: string; is_qc: boolean; sort_order: number; active: boolean }[]>`
    SELECT id, name, is_qc, sort_order, active FROM production.processes
    WHERE organization_id = ${org(context)} ORDER BY active DESC, sort_order, name
  `;
  return { items: rows.map((row) => ({ id: row.id, name: row.name, isQc: row.is_qc, sortOrder: row.sort_order, active: row.active })) };
};

export const upsertProcess = async (context: AccessContext, id: string | null, input: In<typeof UpsertProcessRequestSchema>) => {
  assertProductionAdmin(context);
  const sql = getSql();
  if (id) {
    const rows = await sql`
      UPDATE production.processes
      SET name = ${input.name}, is_qc = coalesce(${input.isQc ?? null}, is_qc),
          sort_order = coalesce(${input.sortOrder ?? null}, sort_order), active = coalesce(${input.active ?? null}, active)
      WHERE organization_id = ${org(context)} AND id = ${id} RETURNING id
    `;
    if (rows.length === 0) {
      throw new AppError("PROCESS_NOT_FOUND", "Không tìm thấy quy trình.", 404);
    }
  } else {
    await sql`
      INSERT INTO production.processes (organization_id, name, is_qc, sort_order)
      VALUES (${org(context)}, ${input.name}, ${input.isQc ?? false}, ${input.sortOrder ?? 0})
    `;
  }
  return await listProcesses(context);
};

export const listShifts = async (context: AccessContext) => {
  assertProductionMember(context);
  const rows = await getSql()<{ id: string; name: string; pay_mode: "POINTS" | "MONEY_IF_KPI"; requires_ot_hours: boolean; sort_order: number; active: boolean }[]>`
    SELECT id, name, pay_mode, requires_ot_hours, sort_order, active FROM production.shifts
    WHERE organization_id = ${org(context)} ORDER BY active DESC, sort_order, name
  `;
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      payMode: row.pay_mode,
      requiresOtHours: row.requires_ot_hours,
      sortOrder: row.sort_order,
      active: row.active
    }))
  };
};

export const upsertShift = async (context: AccessContext, id: string | null, input: In<typeof UpsertShiftRequestSchema>) => {
  assertProductionAdmin(context);
  const sql = getSql();
  if (id) {
    const rows = await sql`
      UPDATE production.shifts
      SET name = ${input.name}, pay_mode = ${input.payMode}, requires_ot_hours = coalesce(${input.requiresOtHours ?? null}, requires_ot_hours),
          sort_order = coalesce(${input.sortOrder ?? null}, sort_order), active = coalesce(${input.active ?? null}, active)
      WHERE organization_id = ${org(context)} AND id = ${id} RETURNING id
    `;
    if (rows.length === 0) {
      throw new AppError("SHIFT_NOT_FOUND", "Không tìm thấy ca.", 404);
    }
  } else {
    await sql`
      INSERT INTO production.shifts (organization_id, name, pay_mode, requires_ot_hours, sort_order)
      VALUES (${org(context)}, ${input.name}, ${input.payMode}, ${input.requiresOtHours ?? false}, ${input.sortOrder ?? 0})
    `;
  }
  return await listShifts(context);
};

// Statuses & transitions --------------------------------------------------------------------------

type StatusRow = {
  id: string;
  code: string;
  name: string;
  color: string;
  sort_order: number;
  counts_done: boolean;
  counts_checked: boolean;
  is_terminal: boolean;
  is_initial: boolean;
  set_by_roles: string[];
  active: boolean;
};

export const loadWorkflow = async (sql: QuerySql, organizationId: string) => {
  const [statuses, transitions] = await Promise.all([
    sql<StatusRow[]>`
      SELECT id, code, name, color, sort_order, counts_done, counts_checked, is_terminal, is_initial, set_by_roles, active
      FROM production.statuses WHERE organization_id = ${organizationId} ORDER BY sort_order, code
    `,
    sql<{ id: string; from_status_id: string; to_status_id: string; actors: string[]; requires_note: boolean }[]>`
      SELECT id, from_status_id, to_status_id, actors, requires_note
      FROM production.status_transitions WHERE organization_id = ${organizationId} ORDER BY sort_order, created_at
    `
  ]);
  return {
    statuses: statuses.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      color: toColor(row.color),
      sortOrder: row.sort_order,
      countsDone: row.counts_done,
      countsChecked: row.counts_checked,
      isTerminal: row.is_terminal,
      isInitial: row.is_initial,
      setByRoles: row.set_by_roles.filter((role): role is ProductionRole => (productionRoleCodes as readonly string[]).includes(role)),
      active: row.active
    })),
    transitions: transitions.map((row) => ({
      id: row.id,
      fromStatusId: row.from_status_id,
      toStatusId: row.to_status_id,
      actors: row.actors as ("ASSIGNEE" | "QC" | "JOB_LEADER" | "ACCOUNT" | "LEADER" | "SYSTEM")[],
      requiresNote: row.requires_note
    }))
  };
};

export const getWorkflow = async (context: AccessContext) => {
  assertProductionMember(context);
  return await loadWorkflow(getSql(), org(context));
};

export const upsertStatus = async (context: AccessContext, id: string | null, input: In<typeof UpsertStatusRequestSchema>) => {
  assertProductionAdmin(context);
  const sql = getSql();
  if (id) {
    const rows = await sql`
      UPDATE production.statuses
      SET code = ${input.code}, name = ${input.name}, color = ${input.color}, counts_done = ${input.countsDone},
          counts_checked = ${input.countsChecked}, is_terminal = ${input.isTerminal}, set_by_roles = ${input.setByRoles}::text[],
          active = coalesce(${input.active ?? null}, active)
      WHERE organization_id = ${org(context)} AND id = ${id} RETURNING id
    `;
    if (rows.length === 0) {
      throw new AppError("STATUS_NOT_FOUND", "Không tìm thấy status.", 404);
    }
  } else {
    await sql`
      INSERT INTO production.statuses (organization_id, code, name, color, sort_order, counts_done, counts_checked, is_terminal, set_by_roles)
      SELECT ${org(context)}, ${input.code}, ${input.name}, ${input.color}, coalesce(max(sort_order), 0) + 1,
        ${input.countsDone}, ${input.countsChecked}, ${input.isTerminal}, ${input.setByRoles}::text[]
      FROM production.statuses WHERE organization_id = ${org(context)}
    `;
  }
  return await getWorkflow(context);
};

export const reorderStatuses = async (context: AccessContext, ids: string[]) => {
  assertProductionAdmin(context);
  const sql = getSql();
  await sql`
    UPDATE production.statuses AS s SET sort_order = data.position
    FROM unnest(${ids}::uuid[]) WITH ORDINALITY AS data(id, position)
    WHERE s.organization_id = ${org(context)} AND s.id = data.id
  `;
  return await getWorkflow(context);
};

export const replaceTransitions = async (context: AccessContext, input: In<typeof ReplaceTransitionsRequestSchema>) => {
  assertProductionAdmin(context);
  const sql = getSql();
  await sql.begin(async (tx) => {
    const ids = new Set(
      (await tx<{ id: string }[]>`SELECT id FROM production.statuses WHERE organization_id = ${org(context)}`).map((row) => row.id)
    );
    for (const transition of input.transitions) {
      if (!ids.has(transition.fromStatusId) || !ids.has(transition.toStatusId) || transition.fromStatusId === transition.toStatusId) {
        throw new AppError("TRANSITION_INVALID", "Luồng chuyển trạng thái không hợp lệ.", 400);
      }
    }
    await tx`DELETE FROM production.status_transitions WHERE organization_id = ${org(context)}`;
    for (const [index, transition] of input.transitions.entries()) {
      await tx`
        INSERT INTO production.status_transitions (organization_id, from_status_id, to_status_id, actors, requires_note, sort_order)
        VALUES (${org(context)}, ${transition.fromStatusId}, ${transition.toStatusId}, ${[...new Set(transition.actors)]}::text[],
                ${transition.requiresNote}, ${index})
        ON CONFLICT (organization_id, from_status_id, to_status_id) DO UPDATE SET actors = EXCLUDED.actors, requires_note = EXCLUDED.requires_note
      `;
    }
  });
  return await getWorkflow(context);
};

// Custom fields & tags ----------------------------------------------------------------------------

type FieldRow = {
  id: string;
  entity: "JOB" | "TASK" | "USER" | "CLIENT";
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "SELECT" | "MULTISELECT";
  options: { value: string; label: string; color?: string }[];
  required: boolean;
  show_in_table: boolean;
  sort_order: number;
  active: boolean;
};

export const listCustomFields = async (context: AccessContext, entity: string | null) => {
  assertProductionMember(context);
  const rows = await getSql()<FieldRow[]>`
    SELECT id, entity, key, label, type, options, required, show_in_table, sort_order, active
    FROM production.custom_fields
    WHERE organization_id = ${org(context)} AND (${entity}::text IS NULL OR entity = ${entity}::text)
    ORDER BY entity, sort_order, key
  `;
  return {
    items: rows.map((row) => ({
      id: row.id,
      entity: row.entity,
      key: row.key,
      label: row.label,
      type: row.type,
      options: row.options.map((option) => ({ value: option.value, label: option.label, ...(option.color ? { color: toColor(option.color) } : {}) })),
      required: row.required,
      showInTable: row.show_in_table,
      sortOrder: row.sort_order,
      active: row.active
    }))
  };
};

export const upsertCustomField = async (context: AccessContext, id: string | null, input: In<typeof UpsertCustomFieldRequestSchema>) => {
  assertProductionAdmin(context);
  if ((input.type === "SELECT" || input.type === "MULTISELECT") && input.options.length === 0) {
    throw new AppError("FIELD_OPTIONS_REQUIRED", "Trường chọn cần ít nhất một lựa chọn.", 400);
  }
  const values = input.options.map((option) => option.value);
  if (new Set(values).size !== values.length) {
    throw new AppError("FIELD_OPTIONS_DUPLICATE", "Các lựa chọn bị trùng giá trị.", 400);
  }
  const sql = getSql();
  if (id) {
    const rows = await sql`
      UPDATE production.custom_fields
      SET label = ${input.label}, type = ${input.type}, options = ${sql.json(input.options)}, required = ${input.required},
          show_in_table = ${input.showInTable}, sort_order = ${input.sortOrder}, active = coalesce(${input.active ?? null}, active)
      WHERE organization_id = ${org(context)} AND id = ${id} RETURNING id
    `;
    if (rows.length === 0) {
      throw new AppError("FIELD_NOT_FOUND", "Không tìm thấy trường.", 404);
    }
  } else {
    await sql`
      INSERT INTO production.custom_fields (organization_id, entity, key, label, type, options, required, show_in_table, sort_order)
      VALUES (${org(context)}, ${input.entity}, ${input.key}, ${input.label}, ${input.type}, ${sql.json(input.options)},
              ${input.required}, ${input.showInTable}, ${input.sortOrder})
    `;
  }
  return await listCustomFields(context, null);
};

export const listTags = async (context: AccessContext) => {
  assertProductionMember(context);
  const rows = await getSql()<{ id: string; name: string; color: string; active: boolean }[]>`
    SELECT id, name, color, active FROM production.tags WHERE organization_id = ${org(context)} ORDER BY active DESC, name
  `;
  return { items: rows.map((row) => ({ id: row.id, name: row.name, color: toColor(row.color), active: row.active })) };
};

export const upsertTag = async (context: AccessContext, id: string | null, input: In<typeof UpsertTagRequestSchema>) => {
  assertProductionAdmin(context);
  const sql = getSql();
  if (id) {
    const rows = await sql`
      UPDATE production.tags SET name = ${input.name}, color = ${input.color}, active = coalesce(${input.active ?? null}, active)
      WHERE organization_id = ${org(context)} AND id = ${id} RETURNING id
    `;
    if (rows.length === 0) {
      throw new AppError("TAG_NOT_FOUND", "Không tìm thấy tag.", 404);
    }
  } else {
    await sql`INSERT INTO production.tags (organization_id, name, color) VALUES (${org(context)}, ${input.name}, ${input.color})`;
  }
  return await listTags(context);
};

// Whitelist & notification preferences ------------------------------------------------------------

const emailPattern = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export const listAllowedEmails = async (context: AccessContext) => {
  assertProductionAdmin(context);
  const rows = await getSql()<{ email: string; added_by: string | null; created_at: Date }[]>`
    SELECT ae.email, au.display_name AS added_by, ae.created_at
    FROM public.allowed_emails ae LEFT JOIN public.app_users au ON au.id = ae.added_by
    WHERE ae.organization_id = ${org(context)} ORDER BY ae.email LIMIT 5000
  `;
  return { items: rows.map((row) => ({ email: row.email, addedBy: row.added_by, createdAt: toIso(row.created_at) })) };
};

/** Accepts text pasted from a sheet; reports added / already present / invalid entries. */
export const addAllowedEmails = async (context: AccessContext, text: string) => {
  assertProductionAdmin(context);
  const tokens = [...new Set(text.split(/[\s,;]+/).map((token) => token.trim().toLowerCase()).filter(Boolean))].slice(0, 2000);
  const valid = tokens.filter((token) => emailPattern.test(token) && token.length <= 254);
  const invalid = tokens.filter((token) => !valid.includes(token));
  const sql = getSql();
  const inserted = valid.length
    ? await sql<{ email: string }[]>`
        INSERT INTO public.allowed_emails (organization_id, email, added_by)
        SELECT ${org(context)}, email, ${context.user.id} FROM unnest(${valid}::text[]) AS email
        ON CONFLICT DO NOTHING
        RETURNING email
      `
    : [];
  const added = inserted.map((row) => row.email);
  return { added, alreadyAllowed: valid.filter((email) => !added.includes(email)), invalid };
};

export const removeAllowedEmail = async (context: AccessContext, email: string) => {
  assertProductionAdmin(context);
  await getSql()`DELETE FROM public.allowed_emails WHERE organization_id = ${org(context)} AND email = ${email.toLowerCase()}`;
  return { ok: true as const };
};

export const getNotificationPreferences = async (context: AccessContext) => {
  const row = (await getSql()<{ notify_web: boolean; notify_email: boolean }[]>`
    SELECT notify_web, notify_email FROM public.app_users WHERE id = ${context.user.id}
  `)[0];
  return { notifyWeb: row?.notify_web ?? true, notifyEmail: row?.notify_email ?? false };
};

export const updateNotificationPreferences = async (context: AccessContext, input: { notifyWeb?: boolean | undefined; notifyEmail?: boolean | undefined }) => {
  await getSql()`
    UPDATE public.app_users
    SET notify_web = coalesce(${input.notifyWeb ?? null}, notify_web), notify_email = coalesce(${input.notifyEmail ?? null}, notify_email)
    WHERE id = ${context.user.id}
  `;
  return await getNotificationPreferences(context);
};

// Credit rules ------------------------------------------------------------------------------------

/** Money per image is hidden from non-admins unless the organization made it public (SPEC §10). */
const canSeeMoney = async (context: AccessContext) =>
  isProductionAdmin(context) || (await loadSettings(getSql(), org(context))).moneyPublic;

const stripMoney = <T extends { moneyPerImage: number | null }>(rule: T, visible: boolean): T =>
  visible ? rule : { ...rule, moneyPerImage: null };

export const getCreditMatrix = async (context: AccessContext, at: string | undefined) => {
  assertProductionMember(context);
  const day = at ?? businessDay(new Date());
  if (!isValidDay(day)) {
    throw new AppError("INVALID_DATE", "Ngày không hợp lệ.", 400);
  }
  const sql = getSql();
  const [projects, processes, rules, money] = await Promise.all([
    selectProductionProjects(sql, org(context)),
    listProcesses(context),
    listRulesAt(sql, org(context), day),
    canSeeMoney(context)
  ]);
  return {
    at: day,
    projects: projects.map(toProject),
    processes: processes.items,
    rules: rules.map((rule) => stripMoney(rule, money))
  };
};

export const getCreditHistory = async (context: AccessContext, projectId: string, processId: string) => {
  assertProductionMember(context);
  const money = await canSeeMoney(context);
  return { items: (await listRuleHistory(getSql(), org(context), projectId, processId)).map((rule) => stripMoney(rule, money)) };
};

const assertCatalogPair = async (sql: QuerySql, organizationId: string, projectId: string, processId: string) => {
  const rows = await sql`
    SELECT 1 FROM production.projects p, production.processes pr
    WHERE p.organization_id = ${organizationId} AND p.id = ${projectId}
      AND pr.organization_id = ${organizationId} AND pr.id = ${processId}
  `;
  if (rows.length === 0) {
    throw new AppError("CATALOG_NOT_FOUND", "Không tìm thấy dự án hoặc quy trình.", 404);
  }
};

export const putCreditRule = async (context: AccessContext, input: In<typeof SetCreditRuleRequestSchema>) => {
  assertProductionAdmin(context);
  const sql = getSql();
  await sql.begin(async (tx) => {
    await assertCatalogPair(tx, org(context), input.projectId, input.processId);
    await setCreditRule(tx, { organizationId: org(context), ...input, userId: context.user.id });
  });
  return await getCreditHistory(context, input.projectId, input.processId);
};

export const createCreditVersion = async (context: AccessContext, effectiveFrom: string) => {
  assertProductionAdmin(context);
  const created = await getSql().begin(async (tx) => await startNewVersion(tx, org(context), effectiveFrom, context.user.id));
  return { created };
};

export const importCredits = async (context: AccessContext, input: In<typeof CreditImportRequestSchema>) => {
  assertProductionAdmin(context);
  const sql = getSql();
  // A failed validation returns its errors after the transaction is rolled back, so nothing is written.
  try {
    return await sql.begin(async (tx) => {
      const result = await importCreditRules(tx, { organizationId: org(context), ...input, userId: context.user.id });
      if (!result.ok) {
        throw new ImportRejected(result);
      }
      return result;
    });
  } catch (error) {
    if (error instanceof ImportRejected) {
      return error.result;
    }
    throw error;
  }
};

class ImportRejected extends Error {
  constructor(readonly result: CreditImportResult) {
    super("Credit import rejected");
  }
}
