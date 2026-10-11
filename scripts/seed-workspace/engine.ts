/**
 * Orchestrates the realistic workspace seed. Loaded by ../seed-workspace.ts after the module hooks are in
 * place (outbox / realtime / chat quota shims), so every import below already resolves through them
 * (except in --disable-departed mode, which runs without hooks, like the app).
 */
import { setTimeout as sleep } from "node:timers/promises";

import { closeDatabase } from "../../src/db/client.js";
import { removeObjects } from "../../src/lib/storage.js";
import { closeRedis } from "../../src/lib/redis.js";
import { invalidateAccessContexts, type AccessContext } from "../../src/modules/access/access-context.js";
import { setAuthUserBanned } from "../../src/modules/auth/supabase-admin.service.js";
import { archiveProject } from "../../src/modules/work/projects.service.js";
import { revokeUserSessions } from "../../src/modules/workspace/members.service.js";
import { updateOrganizationMember } from "../../src/modules/workspace/workspace.service.js";
import {
  SeedEnv,
  allPersonaKeys,
  ensureSeedPassword,
  exEmployees,
  gotrueAdmin,
  jobTitles,
  personaEmails,
  roleOfPersona,
  type Persona,
  type RoleKey
} from "./env.js";
import { backdate, loadScope, rebuildInbox, refreshMentionLabels, setReadMarkers, type Scope } from "./finalize.js";
import { ChatPlanner, seedClientIdPrefix } from "./plan-chat.js";
import { WorkPlanner, describeWork } from "./plan-work.js";
import { DAY, HOUR, MINUTE, at, local } from "./time.js";
import type { ChatScene, CommentPool, PersonaKey, ProjectSeed } from "./types.js";

export const seedProjectKeys = ["VH", "MKT", "HR", "IT", "QT", "CSKH", "BDH", "NS", "CVP"];
export const seedChannelNames = [
  "chung", "thong-bao", "san-xuat", "qc-chat-luong", "marketing", "it-ho-tro", "tan-gau", "ban-dieu-hanh", "leader-san-xuat",
  "team-building-thang-9"
];

type Args = { reset: boolean; relabel: boolean; plan: boolean; disableDeparted: boolean; seed: number };

const parseArgs = (argv: string[]): Args => ({
  reset: argv.includes("--reset"),
  relabel: argv.includes("--relabel"),
  plan: argv.includes("--plan"),
  disableDeparted: argv.includes("--disable-departed"),
  seed: Number(argv[argv.indexOf("--seed") + 1] ?? "") || 20261010
});

const log = (...parts: unknown[]) => console.log(`[seed-workspace ${new Date().toISOString().slice(11, 19)}]`, ...parts);

// Content ------------------------------------------------------------------------------------------------------

const optional = async <T>(path: string, name: string, fallback: T): Promise<T> => {
  try {
    const module = (await import(path)) as Record<string, unknown>;
    if (module[name] === undefined) {
      throw new Error(`missing export ${name}`);
    }
    return module[name] as T;
  } catch (error) {
    log(`content ${path} unavailable (${error instanceof Error ? error.message.split("\n")[0] : error}) — skipped`);
    return fallback;
  }
};

const loadContent = async () => {
  const projects = [
    ...(await optional<ProjectSeed[]>("./content/projects-vh.js", "projectsVh", [])),
    ...(await optional<ProjectSeed[]>("./content/projects-mkt-hr.js", "projectsMktHr", [])),
    ...(await optional<ProjectSeed[]>("./content/projects-it-qt.js", "projectsItQt", [])),
    ...(await optional<ProjectSeed[]>("./content/projects-cskh-bdh.js", "projectsCskhBdh", []))
  ];
  const pool = await optional<CommentPool>("./content/comment-pool.js", "commentPool", {
    progress: ["Em đang làm, chiều nay cập nhật tiếp."],
    question: ["Phần này mình chốt phương án nào ạ?"],
    review: ["Đã xem, ổn rồi."],
    blocker: ["Đang chờ thông tin thêm."],
    done: ["Xong rồi nhé."],
    managerNudge: ["Cập nhật tiến độ giúp mình nhé {assignee}."]
  });
  const scenes = [
    ...(await optional<ChatScene[]>("./content/chat-general.js", "scenesGeneral", [])),
    ...(await optional<ChatScene[]>("./content/chat-production.js", "scenesProduction", [])),
    ...(await optional<ChatScene[]>("./content/chat-quality.js", "scenesQuality", [])),
    ...(await optional<ChatScene[]>("./content/chat-office.js", "scenesOffice", [])),
    ...(await optional<ChatScene[]>("./content/chat-social.js", "scenesSocial", [])),
    ...(await optional<ChatScene[]>("./content/chat-direct.js", "scenesDirect", []))
  ];
  return { projects, pool, scenes };
};

// Setup ----------------------------------------------------------------------------------------------------------

/** Loads the personas (ex-employees included whatever their status) and checks the required accounts. */
const loadPersonas = async (env: SeedEnv) => {
  const sql = env.sql;
  const org = env.organizationId;
  const rows = await sql<{ id: string; email: string; display_name: string }[]>`
    SELECT au.id, au.email, au.display_name FROM public.app_users au
    JOIN public.organization_memberships om ON om.user_id = au.id AND om.organization_id = ${org} AND om.deleted_at IS NULL
    WHERE au.deleted_at IS NULL AND lower(au.email) = ANY(${Object.values(personaEmails)}::text[])
  `;
  const byEmail = new Map(rows.map((row) => [row.email.toLowerCase(), row]));
  // The director is whoever holds the superadmin role (earliest active membership).
  const superadmin = (
    await sql<{ id: string; email: string; display_name: string }[]>`
      SELECT au.id, au.email, au.display_name FROM public.organization_memberships om
      JOIN public.roles r ON r.id = om.role_id AND r.organization_id = om.organization_id AND r.key = 'superadmin' AND r.deleted_at IS NULL
      JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
      WHERE om.organization_id = ${org} AND om.status = 'active' AND om.deleted_at IS NULL
      ORDER BY om.joined_at NULLS LAST, om.created_at LIMIT 1
    `
  )[0];
  env.personas.clear();
  for (const key of allPersonaKeys) {
    const row = key === "boss" ? superadmin : byEmail.get(personaEmails[key]);
    if (!row) {
      continue;
    }
    const ex = exEmployees.find((entry) => entry.key === key);
    const persona: Persona = { key, id: row.id, email: row.email, label: row.display_name, role: roleOfPersona(key), leftAt: ex?.leftAt ?? null };
    env.personas.set(key, persona);
  }
  for (const [missing, fallback] of [["lead2", "lead1"], ["acc2", "acc1"]] as [PersonaKey, PersonaKey][]) {
    if (env.personas.has(missing)) {
      env.alias.delete(missing);
    } else if (!env.alias.has(missing)) {
      env.alias.set(missing, fallback);
      log(`${personaEmails[missing]} not found — its content goes to ${personaEmails[fallback]}`);
    }
  }
  for (const key of ["boss", "linh", "admin", "minh", "an", "khoa", "lead1", "acc1"] as PersonaKey[]) {
    if (!env.personas.has(key)) {
      throw new Error(`Required account ${key === "boss" ? "(active superadmin)" : personaEmails[key]} is missing (run seed-dev-users / seed-from-worklog first).`);
    }
  }
};

/**
 * Ex-employees for a full replay: created once (password in BE/.env.seed) and re-activated (membership active,
 * GoTrue ban lifted) so they can act before their leaving date. The replay disables them again on that date
 * and enforceDepartures() makes sure they end disabled + banned whatever happens.
 */
const prepareExEmployees = async (env: SeedEnv) => {
  const sql = env.sql;
  const org = env.organizationId;
  const memberRole = (await sql<{ id: string }[]>`SELECT id FROM public.roles WHERE organization_id = ${org} AND key = 'member' AND deleted_at IS NULL`)[0]!;
  for (const ex of exEmployees) {
    const email = personaEmails[ex.key];
    let id = (await sql<{ id: string }[]>`SELECT id FROM auth.users WHERE lower(email) = ${email}`)[0]?.id;
    if (!id) {
      const created = await gotrueAdmin("/users", {
        method: "POST",
        body: JSON.stringify({ email, password: ensureSeedPassword(ex.envKey, email), email_confirm: true, user_metadata: { display_name: ex.displayName } })
      });
      if (created.status >= 300) {
        throw new Error(`Creating ${email} failed with ${created.status}`);
      }
      id = (await sql<{ id: string }[]>`SELECT id FROM auth.users WHERE lower(email) = ${email}`)[0]?.id;
    } else {
      ensureSeedPassword(ex.envKey, email);
      await setAuthUserBanned(id, false);
    }
    if (!id) {
      throw new Error(`Account ${email} missing`);
    }
    const joined = at("2026-08-24", 9, 0);
    await sql`
      INSERT INTO public.app_users (id, email, display_name, job_title, created_at, updated_at)
      VALUES (${id}, ${email}, ${ex.displayName}, ${ex.jobTitle}, ${new Date(joined)}, ${new Date(joined)})
      ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, job_title = EXCLUDED.job_title, deleted_at = NULL
    `;
    await sql`
      INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, joined_at, created_at)
      VALUES (${org}, ${id}, ${memberRole.id}, 'active', ${new Date(joined)}, ${new Date(joined)})
      ON CONFLICT (organization_id, user_id) WHERE deleted_at IS NULL DO UPDATE SET status = 'active'
    `;
  }
};

/**
 * Only a full replay touches the ex-employees (`replay`). Every other mode (--reset, --relabel, --plan,
 * --disable-departed) leaves their status alone: they used to be re-activated in every mode while only the full
 * replay disabled them again, so a later --relabel / --plan run left both ex-employees active (SEC2-13).
 */
const resolvePersonas = async (env: SeedEnv, options: { replay: boolean }) => {
  const org = (await env.sql<{ id: string }[]>`SELECT id FROM public.organizations WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`)[0];
  if (!org) {
    throw new Error("No organization found.");
  }
  env.organizationId = org.id;
  // Required accounts are checked before anything is re-activated.
  await loadPersonas(env);
  if (options.replay) {
    await prepareExEmployees(env);
    await loadPersonas(env);
  }
};

const permissionsFor: Record<"admin" | "truong_nhom_du_an", string[] | "all"> = {
  admin: "all",
  truong_nhom_du_an: [
    "project.view", "project.create", "project.update", "project.manage_members",
    "list.view", "list.create", "list.update", "list.delete", "list.manage_status",
    "task.view", "task.create", "task.update", "task.delete", "task.assign", "task.comment",
    "status.view", "status.create", "status.update",
    "channel.view", "channel.create", "channel.manage_members",
    "knowledge.view", "member.view"
  ]
};

const setupRoles = async (env: SeedEnv) => {
  const sql = env.sql;
  const org = env.organizationId;
  const bossId = env.p("boss").id;
  await sql`UPDATE public.roles SET name = 'Quản lý', description = 'Quản lý vận hành: tạo dự án, danh sách, trạng thái; quản lý thành viên và kênh.' WHERE organization_id = ${org} AND key = 'manager' AND deleted_at IS NULL`;
  await sql`UPDATE public.roles SET name = 'Thành viên', description = 'Nhân viên: xem dự án, tạo và cập nhật công việc, bình luận, nhắn tin.' WHERE organization_id = ${org} AND key = 'member' AND deleted_at IS NULL`;
  const allPermissions = (await sql<{ key: string }[]>`SELECT key FROM public.permissions`).map((row) => row.key);
  const roleRows: { key: "admin" | "truong_nhom_du_an"; name: string; description: string }[] = [
    { key: "admin", name: "Quản trị viên", description: "Quản trị hệ thống: thành viên, vai trò và quyền, dự án, kênh. Không thay thế Superadmin." },
    { key: "truong_nhom_du_an", name: "Trưởng nhóm dự án", description: "Tạo và điều hành dự án của nhóm: danh sách, quy trình trạng thái, thành viên dự án, giao việc." }
  ];
  for (const role of roleRows) {
    const row = (
      await sql<{ id: string }[]>`
        INSERT INTO public.roles (organization_id, key, name, description, is_system, created_by, created_at, updated_at)
        VALUES (${org}, ${role.key}, ${role.name}, ${role.description}, false, ${bossId}, ${new Date(at("2026-08-24", 16, 10))}, ${new Date(at("2026-08-24", 16, 10))})
        ON CONFLICT (organization_id, key) WHERE deleted_at IS NULL DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
        RETURNING id
      `
    )[0]!;
    const permissions = permissionsFor[role.key] === "all" ? allPermissions : (permissionsFor[role.key] as string[]);
    await sql`DELETE FROM public.role_permissions WHERE role_id = ${row.id} AND NOT (permission_key = ANY(${permissions}::text[]))`;
    await sql`
      INSERT INTO public.role_permissions (organization_id, role_id, permission_key, granted_by)
      SELECT ${org}, ${row.id}, unnest(${permissions}::text[]), ${bossId}
      ON CONFLICT DO NOTHING
    `;
  }
  const roles = await sql<{ id: string; key: string }[]>`SELECT id, key FROM public.roles WHERE organization_id = ${org} AND deleted_at IS NULL`;
  const roleId = new Map(roles.map((row) => [row.key, row.id]));
  for (const persona of env.personas.values()) {
    if (persona.role === "superadmin") {
      continue;
    }
    await sql`
      UPDATE public.organization_memberships SET role_id = ${roleId.get(persona.role)!}
      WHERE organization_id = ${org} AND user_id = ${persona.id} AND deleted_at IS NULL AND role_id <> ${roleId.get(persona.role)!}
    `;
  }
  for (const role of ["superadmin", "admin", "manager", "truong_nhom_du_an", "member"] as RoleKey[]) {
    const permissions = await sql<{ permission_key: string }[]>`
      SELECT rp.permission_key FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id
      WHERE r.organization_id = ${org} AND r.key = ${role} AND r.deleted_at IS NULL
    `;
    env.rolePermissions.set(role, new Set(permissions.map((row) => row.permission_key)));
  }
  // Realistic join dates (the organization went live on 2026-08-24).
  await sql`
    UPDATE public.organization_memberships om
    SET joined_at = ${new Date(at("2026-08-24", 9, 30))} + (random() * interval '7 hours'),
        created_at = ${new Date(at("2026-08-24", 9, 0))}
    WHERE om.organization_id = ${org} AND om.deleted_at IS NULL
      AND om.user_id = ANY(${[...env.personas.values()].filter((persona) => persona.role !== "superadmin").map((persona) => persona.id)}::uuid[])
      AND (om.joined_at IS NULL OR om.joined_at > ${new Date(at("2026-08-25"))})
  `;
  for (const [key, title] of Object.entries(jobTitles) as [PersonaKey, string][]) {
    if (env.has(key)) {
      await sql`UPDATE public.app_users SET job_title = ${title} WHERE id = ${env.p(key).id} AND job_title IS NULL`;
    }
  }
  await invalidateAccessContexts();
  env.forgetContexts();
};

/**
 * Removes an account for good (auth.users → app_users and everything that cascades from it), in SQL as the
 * database owner: GoTrue's admin DELETE fails on this stack because the cascade fires
 * channel_members_maintain_count(), which then runs as supabase_auth_admin without privileges on
 * public.channels ("permission denied for table channels").
 */
const deleteAuthUser = async (env: SeedEnv, userId: string) => {
  try {
    await env.sql`DELETE FROM auth.users WHERE id = ${userId}`;
    return true;
  } catch (error) {
    log(`could not delete account ${userId}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
};

/** Leftover e2e accounts (soft-deleted profiles + memberships) are removed for good via the GoTrue admin API. */
const removeE2eAccounts = async (env: SeedEnv) => {
  const sql = env.sql;
  const victims = await sql<{ id: string; email: string }[]>`
    SELECT u.id, u.email FROM public.app_users u
    WHERE u.deleted_at IS NOT NULL
      AND (u.email LIKE 'e2e.member.%@nesso.test' OR u.email LIKE 'new.%@nesso.test' OR u.email ~ '^e{20,}@nesso\\.test$')
      AND NOT EXISTS (SELECT 1 FROM public.organization_memberships om WHERE om.user_id = u.id AND om.deleted_at IS NULL)
  `;
  let removed = 0;
  const kept: string[] = [];
  for (const victim of victims) {
    const blockers = await sql<{ n: number }[]>`
      SELECT (
        (SELECT count(*) FROM public.task_comments WHERE author_user_id = ${victim.id}) +
        (SELECT count(*) FROM production.comments WHERE user_id = ${victim.id}) +
        (SELECT count(*) FROM production.feedbacks WHERE created_by = ${victim.id}) +
        (SELECT count(*) FROM production.jobs WHERE created_by = ${victim.id} OR leader_id = ${victim.id}) +
        (SELECT count(*) FROM production.kpi_settlements WHERE user_id = ${victim.id}) +
        (SELECT count(*) FROM production.score_entries WHERE user_id = ${victim.id}) +
        (SELECT count(*) FROM production.task_logs WHERE user_id = ${victim.id}) +
        (SELECT count(*) FROM production.tasks WHERE assignee_id = ${victim.id} OR created_by = ${victim.id} OR qc_id = ${victim.id})
      )::int AS n
    `;
    if ((blockers[0]?.n ?? 0) > 0) {
      kept.push(victim.email);
      continue;
    }
    if (await deleteAuthUser(env, victim.id)) {
      removed += 1;
    } else {
      kept.push(victim.email);
    }
  }
  env.count("accounts.e2e_removed", removed);
  if (kept.length > 0) {
    log(`kept ${kept.length} e2e accounts (still referenced): ${kept.join(", ")}`);
  }
};

// Reset ------------------------------------------------------------------------------------------------------------

const resetContent = async (env: SeedEnv) => {
  const sql = env.sql;
  const scope = await loadScope(env, seedProjectKeys, seedChannelNames);
  const named = await sql<{ id: string }[]>`SELECT id FROM public.channels WHERE id = ANY(${scope.channelIds}::uuid[]) AND kind IN ('public', 'private')`;
  const directs = await sql<{ id: string; foreign: boolean }[]>`
    SELECT c.id, EXISTS (
      SELECT 1 FROM public.messages m WHERE m.channel_id = c.id AND m.kind = 'user'
        AND (m.client_message_id IS NULL OR m.client_message_id::text NOT LIKE ${`${seedClientIdPrefix}%`})
    ) AS foreign
    FROM public.channels c WHERE c.id = ANY(${scope.channelIds}::uuid[]) AND c.kind IN ('dm', 'group_dm')
  `;
  const paths = await sql<{ storage_path: string }[]>`
    SELECT storage_path FROM public.task_attachments WHERE project_id = ANY(${scope.projectIds}::uuid[])
    UNION ALL
    SELECT a.storage_path FROM public.message_attachments a
    WHERE a.channel_id = ANY(${[...named.map((row) => row.id), ...directs.filter((row) => !row.foreign).map((row) => row.id)]}::uuid[])
       OR a.message_id IN (SELECT id FROM public.messages WHERE channel_id = ANY(${directs.map((row) => row.id)}::uuid[]) AND client_message_id::text LIKE ${`${seedClientIdPrefix}%`})
  `;
  for (let index = 0; index < paths.length; index += 100) {
    await removeObjects(paths.slice(index, index + 100).map((row) => row.storage_path)).catch((error: unknown) => log("storage cleanup failed", error));
  }
  await sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = 0`;
    await tx`
      DELETE FROM public.notifications
      WHERE organization_id = ${env.organizationId}
        AND (project_id = ANY(${scope.projectIds}::uuid[]) OR channel_id = ANY(${scope.channelIds}::uuid[]) OR dedupe_key LIKE 'seed:%')
    `;
    for (let guard = 0; guard < 12; guard += 1) {
      const deleted = await tx`
        DELETE FROM public.tasks t
        WHERE t.project_id = ANY(${scope.projectIds}::uuid[])
          AND NOT EXISTS (SELECT 1 FROM public.tasks c WHERE c.parent_task_id = t.id)
      `;
      if (deleted.count === 0) {
        break;
      }
    }
    await tx`DELETE FROM public.projects WHERE id = ANY(${scope.projectIds}::uuid[])`;
    await tx`DELETE FROM public.channels WHERE id = ANY(${[...named.map((row) => row.id), ...directs.filter((row) => !row.foreign).map((row) => row.id)]}::uuid[])`;
    await tx`
      DELETE FROM public.messages
      WHERE channel_id = ANY(${directs.filter((row) => row.foreign).map((row) => row.id)}::uuid[]) AND client_message_id::text LIKE ${`${seedClientIdPrefix}%`}
    `;
  });
  return { projects: scope.projectIds.length, channels: named.length + directs.filter((row) => !row.foreign).length, files: paths.length };
};

const fullReset = async (env: SeedEnv) => {
  const sql = env.sql;
  const removed = await resetContent(env);
  const memberRole = (await sql<{ id: string }[]>`SELECT id FROM public.roles WHERE organization_id = ${env.organizationId} AND key = 'member' AND deleted_at IS NULL`)[0]!;
  for (const ex of exEmployees) {
    const persona = env.personas.get(ex.key);
    if (persona) {
      await deleteAuthUser(env, persona.id);
    }
  }
  await sql`
    UPDATE public.organization_memberships om SET role_id = ${memberRole.id}
    FROM public.roles r
    WHERE r.id = om.role_id AND om.organization_id = ${env.organizationId} AND r.key IN ('admin', 'truong_nhom_du_an')
  `;
  for (const key of ["lead1", "lead2"] as PersonaKey[]) {
    if (env.personas.has(key)) {
      await sql`UPDATE public.organization_memberships SET role_id = ${memberRole.id} WHERE organization_id = ${env.organizationId} AND user_id = ${env.p(key).id}`;
    }
  }
  await sql`DELETE FROM public.roles WHERE organization_id = ${env.organizationId} AND key IN ('admin', 'truong_nhom_du_an')`;
  await sql`UPDATE public.projects SET archived_at = NULL WHERE organization_id = ${env.organizationId} AND key = 'TT' AND archived_at IS NOT NULL`;
  await invalidateAccessContexts();
  return removed;
};

// Execution -----------------------------------------------------------------------------------------------------

/**
 * The app's own "disable member": PATCH /organization/members/:id with status "disabled"
 * (src/modules/workspace/workspace.routes.ts) — updateOrganizationMember (member.manage, superadmin and
 * production-role checks), cached access contexts invalidated, every session revoked, GoTrue account banned.
 * Unlike the route, a failed ban throws here so the seed reports it.
 */
const disableMember = async (context: AccessContext, membershipId: string) => {
  const member = await updateOrganizationMember(context, membershipId, { status: "disabled" });
  await invalidateAccessContexts();
  await revokeUserSessions(member.user.id);
  await setAuthUserBanned(member.user.id, true);
  return member;
};

const departureState = async (env: SeedEnv, userId: string) =>
  (
    await env.sql<{ membership_id: string; status: string; banned: boolean }[]>`
      SELECT om.id AS membership_id, om.status, COALESCE(u.banned_until > now(), false) AS banned
      FROM public.organization_memberships om JOIN auth.users u ON u.id = om.user_id
      WHERE om.organization_id = ${env.organizationId} AND om.user_id = ${userId} AND om.deleted_at IS NULL
    `
  )[0];

const scheduleDepartures = (env: SeedEnv) => {
  for (const ex of exEmployees) {
    if (!env.personas.has(ex.key)) {
      continue;
    }
    const persona = env.p(ex.key);
    env.schedule(ex.leftAt, "member.disable", "admin", async () => {
      const state = await departureState(env, persona.id);
      if (!state) {
        return;
      }
      await disableMember(await env.ctx("admin"), state.membership_id);
      env.forgetContexts();
      env.count("accounts.disabled");
    });
  }
};

/**
 * Every ex-employee whose leaving date has passed must end disabled + banned — checked against the database,
 * not the replay's bookkeeping. Runs after every full replay (also one that failed half-way, since the replay
 * re-activated them) and as --disable-departed. Returns how many accounts it had to disable.
 */
const enforceDepartures = async (env: SeedEnv) => {
  let disabled = 0;
  for (const ex of exEmployees) {
    const persona = env.personas.get(ex.key);
    if (!persona || ex.leftAt > env.planEnd) {
      continue;
    }
    const state = await departureState(env, persona.id);
    if (!state || (state.status === "disabled" && state.banned)) {
      continue;
    }
    log(`${persona.email} left on ${local(ex.leftAt).date} but is ${state.status}${state.banned ? "" : ", not banned"} — disabling (app flow)`);
    await disableMember(await env.ctx("admin"), state.membership_id);
    env.forgetContexts();
    disabled += 1;
    const after = await departureState(env, persona.id);
    if (after && (after.status !== "disabled" || !after.banned)) {
      throw new Error(`${persona.email} is still ${after.status}${after.banned ? "" : ", not banned"}`);
    }
  }
  env.count("accounts.disabled_on_check", disabled);
  return disabled;
};

const execute = async (env: SeedEnv) => {
  const actions = env.actions.filter((action) => action.at <= env.planEnd).sort((a, b) => a.at - b.at || a.order - b.order);
  const clock: { real: string; planned: string }[] = [];
  const started = Date.now();
  let index = 0;
  for (const action of actions) {
    index += 1;
    if (action.actor && !env.active(action.actor, action.at)) {
      env.count("actions.skipped_inactive");
      continue;
    }
    const real = (await env.sql<{ t: string }[]>`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS t`)[0]!.t;
    clock.push({ real, planned: new Date(action.at).toISOString() });
    try {
      await action.run();
    } catch (error) {
      const message = error instanceof Error ? `${(error as { code?: string }).code ?? ""} ${error.message}`.trim() : String(error);
      env.errors.push({ label: action.label, message });
      env.count(`errors.${action.label}`);
    }
    if (index % 1000 === 0) {
      log(`${index}/${actions.length} actions (${Math.round((Date.now() - started) / 1000)} s, planned ${local(action.at).date})`);
    }
  }
  log(`executed ${actions.length} actions in ${Math.round((Date.now() - started) / 1000)} s, ${env.errors.length} errors`);
  return clock;
};

// Summary ------------------------------------------------------------------------------------------------------------

const summary = async (env: SeedEnv, scope: Scope) => {
  const sql = env.sql;
  const [row] = await sql<Record<string, number>[]>`
    SELECT
      (SELECT count(*) FROM public.projects WHERE id = ANY(${scope.projectIds}::uuid[]))::int AS projects,
      (SELECT count(*) FROM public.projects WHERE id = ANY(${scope.projectIds}::uuid[]) AND archived_at IS NOT NULL)::int AS projects_archived,
      (SELECT count(*) FROM public.lists WHERE project_id = ANY(${scope.projectIds}::uuid[]))::int AS lists,
      (SELECT count(*) FROM public.task_statuses WHERE project_id = ANY(${scope.projectIds}::uuid[]) OR list_id IN (SELECT id FROM public.lists WHERE project_id = ANY(${scope.projectIds}::uuid[])))::int AS task_statuses,
      (SELECT count(*) FROM public.project_memberships WHERE project_id = ANY(${scope.projectIds}::uuid[]) AND deleted_at IS NULL)::int AS project_memberships,
      (SELECT count(*) FROM public.tasks WHERE project_id = ANY(${scope.projectIds}::uuid[]) AND parent_task_id IS NULL)::int AS tasks,
      (SELECT count(*) FROM public.tasks WHERE project_id = ANY(${scope.projectIds}::uuid[]) AND parent_task_id IS NOT NULL)::int AS subtasks,
      (SELECT count(*) FROM public.tasks WHERE project_id = ANY(${scope.projectIds}::uuid[]) AND completed_at IS NOT NULL)::int AS tasks_completed,
      (SELECT count(*) FROM public.tasks WHERE project_id = ANY(${scope.projectIds}::uuid[]) AND deleted_at IS NOT NULL)::int AS tasks_in_trash,
      (SELECT count(*) FROM public.task_assignees WHERE task_id IN (SELECT id FROM public.tasks WHERE project_id = ANY(${scope.projectIds}::uuid[])) AND removed_at IS NULL)::int AS task_assignees,
      (SELECT count(*) FROM public.task_comments WHERE task_id IN (SELECT id FROM public.tasks WHERE project_id = ANY(${scope.projectIds}::uuid[])))::int AS task_comments,
      (SELECT count(*) FROM public.task_activity_events WHERE task_id IN (SELECT id FROM public.tasks WHERE project_id = ANY(${scope.projectIds}::uuid[])))::int AS task_activity_events,
      (SELECT count(*) FROM public.task_attachments WHERE project_id = ANY(${scope.projectIds}::uuid[]) AND status = 'ready')::int AS task_attachments,
      (SELECT count(*) FROM public.channels WHERE id = ANY(${scope.channelIds}::uuid[]))::int AS channels,
      (SELECT count(*) FROM public.channel_members WHERE channel_id = ANY(${scope.channelIds}::uuid[]) AND deleted_at IS NULL)::int AS channel_members,
      (SELECT count(*) FROM public.messages WHERE channel_id = ANY(${scope.channelIds}::uuid[]))::int AS messages,
      (SELECT count(*) FROM public.messages WHERE channel_id = ANY(${scope.channelIds}::uuid[]) AND thread_root_id IS NOT NULL)::int AS thread_replies,
      (SELECT count(*) FROM public.messages WHERE channel_id = ANY(${scope.channelIds}::uuid[]) AND kind = 'system')::int AS system_messages,
      (SELECT count(*) FROM public.message_reactions WHERE channel_id = ANY(${scope.channelIds}::uuid[]))::int AS message_reactions,
      (SELECT count(*) FROM public.message_mentions WHERE channel_id = ANY(${scope.channelIds}::uuid[]))::int AS message_mentions,
      (SELECT count(*) FROM public.message_attachments WHERE channel_id = ANY(${scope.channelIds}::uuid[]) AND status = 'ready')::int AS message_attachments,
      (SELECT count(*) FROM public.notifications WHERE organization_id = ${env.organizationId} AND (project_id = ANY(${scope.projectIds}::uuid[]) OR channel_id = ANY(${scope.channelIds}::uuid[])))::int AS notifications,
      (SELECT count(*) FROM public.notifications WHERE organization_id = ${env.organizationId} AND read_at IS NULL AND (project_id = ANY(${scope.projectIds}::uuid[]) OR channel_id = ANY(${scope.channelIds}::uuid[])))::int AS notifications_unread
  `;
  console.log("\nCounts (seeded scope):");
  console.table(row);
  const stats = Object.fromEntries([...env.stats.entries()].sort(([a], [b]) => a.localeCompare(b)));
  console.log("Run stats:", stats);
  if (env.errors.length > 0) {
    const byMessage = new Map<string, number>();
    for (const error of env.errors) {
      const key = `${error.label}: ${error.message.slice(0, 160)}`;
      byMessage.set(key, (byMessage.get(key) ?? 0) + 1);
    }
    console.log("Errors (grouped):");
    for (const [key, count] of [...byMessage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
      console.log(`  ${count} × ${key}`);
    }
  }
};

// Main -----------------------------------------------------------------------------------------------------------------

export const main = async (argv: string[]) => {
  const args = parseArgs(argv);
  const env = new SeedEnv(args.seed);
  const replay = !args.reset && !args.relabel && !args.plan && !args.disableDeparted;
  // A full replay re-activates the ex-employees: until enforceDepartures() has run they may be active.
  let departuresPending = replay;
  try {
    await resolvePersonas(env, { replay });
    if (args.disableDeparted) {
      const disabled = await enforceDepartures(env);
      log(disabled === 0 ? "ex-employees already disabled + banned" : `ex-employees disabled: ${disabled}`);
      return;
    }
    if (args.reset) {
      const removed = await fullReset(env);
      log("reset done", removed);
      return;
    }
    if (args.relabel) {
      const scope = await loadScope(env, seedProjectKeys, seedChannelNames);
      log(`mention labels refreshed: ${await refreshMentionLabels(env, scope)}`);
      return;
    }
    const content = await loadContent();
    if (!args.plan) {
      const removed = await resetContent(env);
      log("previous seed removed", removed);
      await removeE2eAccounts(env);
    }
    await setupRoles(env);
    const work = new WorkPlanner(env, content.projects, content.pool);
    work.build();
    if (args.plan) {
      console.log(JSON.stringify(describeWork(work, env), null, 1));
      return;
    }
    work.schedule();
    new ChatPlanner(env, content.scenes).plan();
    scheduleDepartures(env);
    log(`planned ${env.actions.length} actions (${content.projects.length} projects, ${content.scenes.length} chat scenes)`);
    const clock = await execute(env);
    await enforceDepartures(env);
    departuresPending = false;

    // The owner's leftover test project gives way to the seeded ones (restorable from "Dự án đã lưu trữ").
    const leftover = (await env.sql<{ id: string }[]>`SELECT id FROM public.projects WHERE organization_id = ${env.organizationId} AND key = 'TT' AND archived_at IS NULL AND deleted_at IS NULL`)[0];
    if (leftover) {
      await archiveProject(await env.ctx("boss"), leftover.id);
    }

    log("backdating…");
    const scope = await loadScope(env, seedProjectKeys, seedChannelNames);
    await backdate(env, scope, clock);
    await setReadMarkers(env, scope);
    await rebuildInbox(env, scope);
    await refreshMentionLabels(env, scope);
    await env.sql`ANALYZE public.tasks, public.task_comments, public.task_activity_events, public.task_assignees, public.messages, public.message_mentions, public.message_reactions, public.channel_members, public.notifications`;
    await invalidateAccessContexts();
    const suppressed = (globalThis as { __seedOutboxSuppressed?: number }).__seedOutboxSuppressed ?? 0;
    env.count("outbox.suppressed", suppressed);
    await summary(env, scope);
    void DAY;
    void HOUR;
    void MINUTE;
  } finally {
    if (departuresPending) {
      // The replay stopped early (or the check failed): the ex-employees must not stay active (SEC2-13).
      await enforceDepartures(env).catch((error: unknown) => {
        log(`ex-employees could not be disabled: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      });
    }
    await sleep(50);
    await closeRedis();
    await closeDatabase();
  }
};
