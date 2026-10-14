import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

import type * as DbClientModule from "../../db/client.js";
import type { QuerySql } from "../../lib/db-types.js";
import type * as RedisModule from "../../lib/redis.js";
import type * as PublisherModule from "../../realtime/publisher.js";
import type { AccessContext } from "../access/access-context.js";

/**
 * Departments (PD-041) on the workspace: a public project is visible to the members of its department, explicit
 * (invited) project members and the superadmin; a private project to its members and the superadmin. Production
 * module access and inbox entries follow the Photo Retouch department.
 *
 * Part 1 runs without a database (a fake tagged-template `sql` records each statement). Part 2 runs the real SQL
 * against the local database when one is reachable and the department migration is applied — inside a transaction
 * that is always rolled back, with throwaway fake organization / users, so nothing is ever written.
 */

type Call = { text: string; values: unknown[] };
type Fragment = { readonly isFragment: true; text: string; values: unknown[] };

/** The `sql` every service gets from `getSql()`: a fake (part 1) or the rolled-back transaction (part 2). */
const state = vi.hoisted((): { sql: unknown } => ({ sql: undefined }));

vi.mock("../../lib/redis.js", async (importOriginal) => ({
  ...(await importOriginal<typeof RedisModule>()),
  hasRedisConfig: () => false,
  getOptionalRedis: () => undefined,
  getRedis: () => {
    throw new Error("Redis is not available in this test");
  }
}));
vi.mock("../../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DbClientModule>()),
  getSql: () => {
    if (!state.sql) {
      throw new Error("No SQL connection in this test");
    }
    return state.sql;
  }
}));
// No live events leave the test.
vi.mock("../../realtime/publisher.js", async (importOriginal) => {
  const original = await importOriginal<typeof PublisherModule>();
  return Object.fromEntries(Object.entries(original).map(([name, value]) => [name, typeof value === "function" ? vi.fn() : value]));
});

const { env } = await import("../../config/env.js");
const { getProjectAccess, visibleProjectsPredicate } = await import("../access/resource-access.js");
const { createProject, getProject, listProjects, removeProjectMember, upsertProjectMember } = await import("./projects.service.js");
const { createTask, mentionEvent, updateTask } = await import("./tasks.service.js");
const { searchDirectory } = await import("./directory.service.js");
const { revokeDepartmentAccessEffects } = await import("./department-access.js");
const { globalSearch } = await import("../search/search.service.js");
const { deliverNotifications, listNotifications } = await import("../notifications/notifications.service.js");
const { filterProjectViewers } = await import("../notifications/notification-handlers.js");
const { getWorkspaceContext } = await import("../workspace/workspace.service.js");
const { assertProductionMember } = await import("../production/access.js");
const { listTeams } = await import("../production/catalog.service.js");
const { GlobalSearchQuerySchema } = await import("../../contracts/search.js");
const { CreateProjectRequestSchema, CreateTaskRequestSchema, UpdateTaskRequestSchema } = await import("../../contracts/work.js");

// Part 1: without a database -----------------------------------------------------------------------

/** Records every statement; `handler` answers it (default: no rows). Fragments are inlined like postgres.js does. */
const fakeSql = (handler: (call: Call) => unknown[] | undefined = () => []) => {
  const calls: Call[] = [];
  const isFragment = (value: unknown): value is Fragment =>
    typeof value === "object" && value !== null && (value as { isFragment?: unknown }).isFragment === true;
  const sql = (strings: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof strings === "string") {
      return { isFragment: true as const, text: `"${strings}"`, values: [] as unknown[] };
    }
    let text = strings[0] ?? "";
    const flat: unknown[] = [];
    values.forEach((value, index) => {
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += "$";
        flat.push(value);
      }
      text += strings[index + 1] ?? "";
    });
    return {
      isFragment: true as const,
      text,
      values: flat,
      then(resolve: (rows: unknown[]) => void, reject: (error: unknown) => void) {
        const call = { text: text.replace(/\s+/g, " ").trim(), values: flat };
        calls.push(call);
        try {
          resolve(handler(call) ?? []);
        } catch (error) {
          reject(error);
        }
      }
    };
  };
  const fake = Object.assign(sql, {
    json: (value: unknown) => value,
    begin: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake),
    savepoint: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake)
  });
  return { sql: fake as unknown as QuerySql, calls };
};

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";

const contextWith = (departments: string[], options: { full?: boolean; permissions?: string[]; productionRoles?: string[] } = {}) =>
  ({
    user: { id: me, email: null, displayName: "Test user" },
    organization: { id: org, slug: "test-org", name: "Test org" },
    role: { id: randomUUID(), organizationId: org, key: options.full ? "superadmin" : "member", name: "Role", permissions: options.permissions ?? ["project.view"] },
    hasFullOrganizationAuthority: options.full ?? false,
    mustChangePassword: false,
    productionRoles: options.productionRoles ?? [],
    departments,
    canSwitchDepartment: departments.length > 1
  }) as unknown as AccessContext;

const projectRow = (visibility: "public" | "private", accessLevel: "view" | "submit" | "manage" | null) => ({
  key: "TEST",
  visibility,
  department: "PRODUCTION",
  access_level: accessLevel
});

describe("project access by department (no database)", () => {
  it("opens a public project to its department only, keeps invitations and the superadmin", async () => {
    const access = async (context: AccessContext, row: ReturnType<typeof projectRow>) =>
      await getProjectAccess(context, projectId, fakeSql(() => [row]).sql);

    expect(await access(contextWith(["PHOTO_RETOUCH"]), projectRow("public", null))).toBeNull();
    expect(await access(contextWith(["PRODUCTION"]), projectRow("public", null))).toMatchObject({
      level: "submit",
      isMember: false,
      department: "PRODUCTION"
    });
    // Invited (explicit member) outside the department keeps the membership level.
    expect(await access(contextWith(["PHOTO_RETOUCH"]), projectRow("public", "view"))).toMatchObject({ level: "view", isMember: true });
    // Private: explicit members only, whatever the department.
    expect(await access(contextWith(["PRODUCTION"]), projectRow("private", null))).toBeNull();
    expect(await access(contextWith(["PHOTO_RETOUCH"]), projectRow("private", "submit"))).toMatchObject({ level: "submit" });
    // The superadmin manages everything.
    expect(await access(contextWith([], { full: true }), projectRow("private", null))).toMatchObject({ level: "manage" });
  });

  it("filters listed projects by membership or a public project of my departments", () => {
    const { sql } = fakeSql();
    const predicate = visibleProjectsPredicate(sql, contextWith(["PHOTO_RETOUCH"])) as unknown as Fragment;
    expect(predicate.text).toContain("p.visibility = 'public' AND p.department = ANY(");
    expect(predicate.values).toContainEqual(["PHOTO_RETOUCH"]);
    expect(predicate.values).toContain(me);
    expect((visibleProjectsPredicate(sql, contextWith([], { full: true })) as unknown as Fragment).text).toBe("TRUE");
  });

  it("refuses project creation outside the Production department (403) before touching the database", async () => {
    const fake = fakeSql();
    state.sql = fake.sql;
    const input = CreateProjectRequestSchema.parse({ key: "TEST", name: "Test project" });
    await expect(createProject(contextWith(["PHOTO_RETOUCH"], { permissions: ["project.view", "project.create"] }), input)).rejects.toMatchObject({
      code: "DEPARTMENT_FORBIDDEN",
      statusCode: 403
    });
    expect(fake.calls).toHaveLength(0);
    state.sql = undefined;
  });

  it("leaves the workspace search groups empty while browsing Photo Retouch", async () => {
    const fake = fakeSql();
    state.sql = fake.sql;
    const context = contextWith(["PHOTO_RETOUCH", "PRODUCTION"], { permissions: ["project.view", "task.view", "list.view"] });
    const scoped = await globalSearch(context, GlobalSearchQuerySchema.parse({ q: "test", groups: "tasks,projects,lists", department: "PHOTO_RETOUCH" }));
    expect(scoped).toMatchObject({ tasks: [], projects: [], lists: [] });
    expect(fake.calls).toHaveLength(0);

    await globalSearch(context, GlobalSearchQuerySchema.parse({ q: "test", groups: "projects", department: "PRODUCTION" }));
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.text).toContain("p.department = ANY(");
    state.sql = undefined;
  });

  it("tags inbox entries with their department and hides production entries outside Photo Retouch", async () => {
    const base = {
      actor: null,
      title: "Title",
      body: null,
      task_id: null,
      comment_id: null,
      channel_id: null,
      message_id: null,
      payload: {},
      created_at: new Date("2026-10-01T00:00:00.000Z"),
      read_at: null,
      cursor_at: "2026-10-01T00:00:00.000000Z"
    };
    const rows = [
      { ...base, id: randomUUID(), type: "production.task_assigned", project_id: null, project_department: null },
      { ...base, id: randomUUID(), type: "task.assigned", project_id: projectId, project_department: "PRODUCTION" },
      { ...base, id: randomUUID(), type: "chat.mentioned", project_id: null, project_department: null }
    ];
    const fake = fakeSql((call) => (call.text.includes("count(*)::int AS count") ? [{ count: 0 }] : rows));
    state.sql = fake.sql;
    const page = await listNotifications(contextWith(["PHOTO_RETOUCH"]), { filter: "all", limit: 30 });
    expect(page.items.map((item) => item.department)).toEqual(["PHOTO_RETOUCH", "PRODUCTION", null]);
    expect(fake.calls[0]?.text).toContain(
      "n.type NOT LIKE 'production.%' OR public.is_department_member(n.organization_id, n.recipient_user_id, 'PHOTO_RETOUCH')"
    );
    expect(fake.calls[0]?.text).toContain("vud.department = vp.department");
    state.sql = undefined;
  });

  it("closes the production module to a STAFF member outside Photo Retouch (empty roles, 404)", async () => {
    const row = (departments: string[]) => ({
      user_id: me,
      email: null,
      display_name: "Test user",
      must_change_password: false,
      production_roles: ["STAFF"],
      departments,
      organization_id: org,
      organization_slug: "test-org",
      organization_name: "Test org",
      role_id: randomUUID(),
      role_key: "member",
      role_name: "Member",
      permissions: ["project.view"]
    });

    state.sql = fakeSql(() => [row(["PRODUCTION"])]).sql;
    const outside = await getWorkspaceContext(me);
    expect(outside.productionRoles).toEqual([]);
    expect(outside.departments).toEqual(["PRODUCTION"]);
    expect(() => assertProductionMember(outside)).toThrow(expect.objectContaining({ statusCode: 404 }) as Error);
    await expect(listTeams(outside)).rejects.toMatchObject({ code: "PRODUCTION_NOT_FOUND", statusCode: 404 });

    state.sql = fakeSql(() => [row(["PHOTO_RETOUCH"])]).sql;
    const inside = await getWorkspaceContext(me);
    expect(inside.productionRoles).toEqual(["STAFF"]);
    expect(() => assertProductionMember(inside)).not.toThrow();
    state.sql = undefined;
  });

  it("never revokes anything from the superadmin on a department change", async () => {
    const fake = fakeSql((call) => (call.text.includes("r.key = 'superadmin'") ? [{ ok: 1 }] : []));
    expect(await revokeDepartmentAccessEffects(fake.sql, contextWith([], { full: true }), me, "PRODUCTION")).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });
});

// Part 2: real SQL in a rolled-back transaction ---------------------------------------------------

let client: postgres.Sql | undefined;
const databaseReady = await (async () => {
  if (!env.DATABASE_URL || process.env.SKIP_DB_TESTS === "1") {
    return false;
  }
  try {
    client = postgres(env.DATABASE_URL, {
      max: 1,
      connect_timeout: 5,
      idle_timeout: 5,
      ssl: env.DATABASE_SSL ? "require" : false,
      onnotice: () => undefined
    });
    const rows = await client<{ ok: boolean }[]>`
      SELECT to_regprocedure('public.is_department_member(uuid,uuid,text)') IS NOT NULL
        AND to_regclass('public.user_departments') IS NOT NULL AS ok
    `;
    return rows[0]?.ok === true;
  } catch {
    await client?.end({ timeout: 1 }).catch(() => undefined);
    client = undefined;
    return false;
  }
})();

afterAll(async () => {
  await client?.end({ timeout: 5 });
});

class Rollback extends Error {}

/**
 * Runs `body` in a transaction that is always rolled back. Services see it through the mocked `getSql()`; their own
 * `sql.begin(...)` become savepoints inside it.
 */
const inRolledBackTransaction = async (body: () => Promise<void>) => {
  try {
    await client!.begin(async (tx) => {
      state.sql = new Proxy(tx, {
        get(target, property) {
          if (property === "begin") {
            return (...args: unknown[]) => target.savepoint(args[args.length - 1] as (sql: postgres.TransactionSql) => Promise<unknown>);
          }
          const value: unknown = Reflect.get(target, property);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        }
      });
      try {
        await body();
      } finally {
        state.sql = undefined;
      }
      throw new Rollback("rollback");
    });
  } catch (error) {
    if (!(error instanceof Rollback)) {
      throw error;
    }
  }
};

const db = () => state.sql as QuerySql;

const memberPermissions = [
  "project.view",
  "project.create",
  "project.update",
  "project.manage_members",
  "task.view",
  "task.create",
  "task.update",
  "task.assign",
  "task.comment",
  "list.view",
  "member.view"
];
const allPermissions = [...memberPermissions, "project.delete", "list.create", "list.update", "list.delete", "list.manage_status", "task.delete", "member.manage"];

type People = { superadmin: string; producer: string; retoucher: string; invited: string; both: string };

/** Throwaway organization: superadmin, a Production member, a Photo Retouch member, one invited later, one in both. */
const createFixture = async () => {
  const sql = db();
  const tag = randomUUID().slice(0, 8);
  const people: People = { superadmin: randomUUID(), producer: randomUUID(), retoucher: randomUUID(), invited: randomUUID(), both: randomUUID() };
  for (const [name, id] of Object.entries(people)) {
    const email = `dept-${tag}-${name}@example.test`;
    await sql`INSERT INTO auth.users (id, email) VALUES (${id}, ${email})`;
    await sql`INSERT INTO public.app_users (id, email, display_name) VALUES (${id}, ${email}, ${`Test ${name} ${tag}`})`;
  }
  const organizationId = (
    await sql<{ id: string }[]>`INSERT INTO public.organizations (slug, name) VALUES (${`test-dept-${tag}`}, 'Test departments') RETURNING id`
  )[0]!.id;
  const roleId = async (key: string, permissions: string[]) => {
    const id = (
      await sql<{ id: string }[]>`
        INSERT INTO public.roles (organization_id, key, name, is_system) VALUES (${organizationId}, ${key}, ${`Test ${key}`}, ${key === "superadmin"})
        RETURNING id
      `
    )[0]!.id;
    await sql`
      INSERT INTO public.role_permissions (organization_id, role_id, permission_key)
      SELECT ${organizationId}, ${id}, unnest(${permissions}::text[])
    `;
    return id;
  };
  const superRole = await roleId("superadmin", allPermissions);
  const memberRole = await roleId("member", memberPermissions);
  for (const [name, id] of Object.entries(people)) {
    await sql`
      INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, joined_at)
      VALUES (${organizationId}, ${id}, ${name === "superadmin" ? superRole : memberRole}, 'active', now())
    `;
  }
  await sql`
    INSERT INTO public.user_departments (organization_id, user_id, department)
    VALUES (${organizationId}, ${people.producer}, 'PRODUCTION'), (${organizationId}, ${people.retoucher}, 'PHOTO_RETOUCH'),
      (${organizationId}, ${people.invited}, 'PHOTO_RETOUCH'), (${organizationId}, ${people.both}, 'PHOTO_RETOUCH'),
      (${organizationId}, ${people.both}, 'PRODUCTION')
  `;
  // STAFF on both sides: only the Photo Retouch member may use it.
  await sql`
    INSERT INTO production.user_roles (organization_id, user_id, role_code)
    VALUES (${organizationId}, ${people.producer}, 'STAFF'), (${organizationId}, ${people.retoucher}, 'STAFF')
  `;
  await sql`
    INSERT INTO public.task_statuses (organization_id, scope, key, name, category, is_initial, position)
    VALUES (${organizationId}, 'global', 'TODO', 'To do', 'active', true, 1)
  `;

  const contexts = {
    superadmin: await getWorkspaceContext(people.superadmin),
    producer: await getWorkspaceContext(people.producer),
    retoucher: await getWorkspaceContext(people.retoucher),
    invited: await getWorkspaceContext(people.invited),
    both: await getWorkspaceContext(people.both)
  };
  const publicProject = await createProject(
    contexts.producer,
    CreateProjectRequestSchema.parse({ key: "DPUB", name: `Test public ${tag}`, visibility: "public" })
  );
  const privateProject = await createProject(
    contexts.producer,
    CreateProjectRequestSchema.parse({ key: "DPRV", name: `Test private ${tag}`, visibility: "private" })
  );
  const task = await createTask(
    contexts.producer,
    publicProject.id,
    CreateTaskRequestSchema.parse({ listId: publicProject.lists[0]!.id, title: `Test task ${tag}`, assigneeIds: [people.producer] })
  );
  return { tag, organizationId, people, contexts, publicProject, privateProject, task };
};

const assigneesOf = async (taskId: string) =>
  (
    await db()<{ user_id: string }[]>`
      SELECT assignee_user_id AS user_id FROM public.task_assignees WHERE task_id = ${taskId} AND removed_at IS NULL
    `
  )
    .map((row) => row.user_id)
    .sort();

describe.runIf(databaseReady)("department visibility on the database (rolled back)", () => {
  it("shows a public Production project to its department, invited members and the superadmin only", async () => {
    await inRolledBackTransaction(async () => {
      const { people, contexts, publicProject, privateProject, tag } = await createFixture();
      expect(publicProject.department).toBe("PRODUCTION");
      expect(contexts.superadmin.departments).toEqual(["PHOTO_RETOUCH", "PRODUCTION"]);

      const visible = async (context: AccessContext) => (await listProjects(context)).items.map((project) => project.id).sort();
      expect(await visible(contexts.retoucher)).toEqual([]);
      expect(await visible(contexts.both)).toEqual([publicProject.id]);
      expect(await visible(contexts.producer)).toEqual([publicProject.id, privateProject.id].sort());
      expect(await visible(contexts.superadmin)).toEqual([publicProject.id, privateProject.id].sort());
      await expect(getProject(contexts.retoucher, publicProject.id)).rejects.toMatchObject({ statusCode: 404 });

      // Invited to the public project: visible without the department; the private one stays closed.
      await upsertProjectMember(contexts.producer, publicProject.id, { userId: people.invited, accessLevel: "submit" });
      expect(await visible(contexts.invited)).toEqual([publicProject.id]);
      expect((await getProject(contexts.invited, publicProject.id)).myAccess).toBe("submit");
      await expect(getProject(contexts.invited, privateProject.id)).rejects.toMatchObject({ statusCode: 404 });

      // Search: projects / tasks / lists follow the same rule, and Photo Retouch browsing leaves them empty.
      const search = async (context: AccessContext, q: string, department?: "PHOTO_RETOUCH" | "PRODUCTION") =>
        await globalSearch(context, GlobalSearchQuerySchema.parse({ q, groups: "tasks,projects,lists", ...(department ? { department } : {}) }));
      expect((await search(contexts.retoucher, `public ${tag}`)).projects).toEqual([]);
      expect((await search(contexts.retoucher, `task ${tag}`)).tasks).toEqual([]);
      expect((await search(contexts.producer, `public ${tag}`)).projects.map((hit) => hit.id)).toEqual([publicProject.id]);
      expect((await search(contexts.producer, `task ${tag}`)).tasks).toHaveLength(1);
      expect((await search(contexts.producer, `public ${tag}`, "PHOTO_RETOUCH")).projects).toEqual([]);
      expect((await search(contexts.invited, `public ${tag}`)).projects.map((hit) => hit.id)).toEqual([publicProject.id]);
    });
  });

  it("only assigns, mentions and suggests people who can see the project", async () => {
    await inRolledBackTransaction(async () => {
      const { organizationId, people, contexts, publicProject, privateProject, task } = await createFixture();
      const add = (userId: string) => UpdateTaskRequestSchema.parse({ assignees: { add: [userId] } });

      await expect(updateTask(contexts.producer, task.id, add(people.retoucher))).rejects.toMatchObject({ code: "ASSIGNEE_NOT_ALLOWED" });
      await updateTask(contexts.producer, task.id, add(people.both));
      await updateTask(contexts.producer, task.id, add(people.superadmin));
      await upsertProjectMember(contexts.producer, publicProject.id, { userId: people.invited, accessLevel: "submit" });
      await updateTask(contexts.producer, task.id, add(people.invited));
      expect(await assigneesOf(task.id)).toEqual([people.producer, people.both, people.superadmin, people.invited].sort());

      const mention = await mentionEvent(db(), contexts.producer, publicProject.id, task.id, task.title, [people.retoucher, people.invited, people.both], "comment");
      expect([...(mention.payload.userIds as string[])].sort()).toEqual([people.invited, people.both].sort());

      expect((await filterProjectViewers(organizationId, publicProject.id, [people.retoucher, people.producer, people.invited])).sort()).toEqual(
        [people.producer, people.invited].sort()
      );

      const picker = async (projectId: string) =>
        (await searchDirectory(contexts.producer, { projectId, limit: 50 })).items.map((user) => user.id).sort();
      expect(await picker(publicProject.id)).toEqual([people.superadmin, people.producer, people.invited, people.both].sort());
      expect(await picker(privateProject.id)).toEqual([people.producer]);
    });
  });

  it("filters and tags inbox entries by department, and skips production entries outside Photo Retouch", async () => {
    await inRolledBackTransaction(async () => {
      const { organizationId, people, contexts, publicProject } = await createFixture();
      const sql = db();
      const insert = async (recipient: string, type: string, project: string | null) =>
        (
          await sql<{ id: string }[]>`
            INSERT INTO public.notifications (organization_id, recipient_user_id, type, project_id, title, dedupe_key)
            VALUES (${organizationId}, ${recipient}, ${type}, ${project}, 'Test entry', ${randomUUID()})
            RETURNING id
          `
        )[0]!.id;
      const retoucherProject = await insert(people.retoucher, "task.assigned", publicProject.id);
      const retoucherProduction = await insert(people.retoucher, "production.task_assigned", null);
      const retoucherShared = await insert(people.retoucher, "system.dead_letter", null);
      const producerProduction = await insert(people.producer, "production.task_assigned", null);
      const producerProject = await insert(people.producer, "task.assigned", publicProject.id);

      const inbox = async (context: AccessContext) =>
        Object.fromEntries((await listNotifications(context, { filter: "all", limit: 50 })).items.map((item) => [item.id, item.department]));
      expect(await inbox(contexts.retoucher)).toEqual({ [retoucherProduction]: "PHOTO_RETOUCH", [retoucherShared]: null });
      expect(retoucherProject).toBeTruthy();
      expect(await inbox(contexts.producer)).toEqual({ [producerProject]: "PRODUCTION" });
      expect(producerProduction).toBeTruthy();

      const delivered = await deliverNotifications({
        organizationId,
        recipientIds: [people.producer, people.retoucher],
        type: "production.task_assigned",
        actorUserId: null,
        title: "Test production entry",
        dedupeKey: `test:${randomUUID()}`
      });
      expect(delivered).toBe(1);
    });
  });

  it("refuses Production projects and the production module to the wrong department", async () => {
    await inRolledBackTransaction(async () => {
      const { contexts } = await createFixture();
      await expect(
        createProject(contexts.retoucher, CreateProjectRequestSchema.parse({ key: "DNOPE", name: "Test refused" }))
      ).rejects.toMatchObject({ code: "DEPARTMENT_FORBIDDEN", statusCode: 403 });
      expect((await createProject(contexts.superadmin, CreateProjectRequestSchema.parse({ key: "DSUP", name: "Test superadmin" }))).department).toBe(
        "PRODUCTION"
      );

      // STAFF in the database, but outside Photo Retouch: no effective production role, the module answers 404.
      expect(contexts.producer.productionRoles).toEqual([]);
      await expect(listTeams(contexts.producer)).rejects.toMatchObject({ statusCode: 404 });
      expect(contexts.retoucher.productionRoles).toEqual(["STAFF"]);
      await expect(listTeams(contexts.retoucher)).resolves.toBeDefined();
    });
  });

  it("unassigns people who lose the department or their invitation, and drops their inbox entries", async () => {
    await inRolledBackTransaction(async () => {
      const { organizationId, people, contexts, publicProject, task } = await createFixture();
      const sql = db();
      const add = (userId: string) => UpdateTaskRequestSchema.parse({ assignees: { add: [userId] } });
      await upsertProjectMember(contexts.producer, publicProject.id, { userId: people.invited, accessLevel: "submit" });
      await updateTask(contexts.producer, task.id, add(people.both));
      await updateTask(contexts.producer, task.id, add(people.invited));
      await updateTask(contexts.producer, task.id, add(people.superadmin));
      for (const recipient of [people.both, people.invited]) {
        await sql`
          INSERT INTO public.notifications (organization_id, recipient_user_id, type, project_id, task_id, title, dedupe_key)
          VALUES (${organizationId}, ${recipient}, 'task.assigned', ${publicProject.id}, ${task.id}, 'Test entry', ${randomUUID()})
        `;
      }
      const inboxCount = async (userId: string) =>
        (
          await sql<{ count: number }[]>`
            SELECT count(*)::int AS count FROM public.notifications WHERE recipient_user_id = ${userId} AND project_id = ${publicProject.id}
          `
        )[0]!.count;

      // "both" leaves Production.
      await sql`DELETE FROM public.user_departments WHERE user_id = ${people.both} AND department = 'PRODUCTION'`;
      const revoked = await revokeDepartmentAccessEffects(sql, contexts.superadmin, people.both, "PRODUCTION");
      expect(revoked).toEqual([{ id: task.id, projectId: publicProject.id, listId: task.listId, parentTaskId: null }]);
      expect(await inboxCount(people.both)).toBe(0);
      const activity = await sql<{ reason: string }[]>`
        SELECT previous_value->>'reason' AS reason FROM public.task_activity_events
        WHERE task_id = ${task.id} AND action = 'TASK_ASSIGNEE_REMOVED' AND target_id = ${people.both}
      `;
      expect(activity.map((row) => row.reason)).toEqual(["department_removed"]);

      // Explicit members and the superadmin keep everything.
      expect(await revokeDepartmentAccessEffects(sql, contexts.superadmin, people.invited, "PRODUCTION")).toEqual([]);
      expect(await revokeDepartmentAccessEffects(sql, contexts.superadmin, people.superadmin, "PRODUCTION")).toEqual([]);
      expect(await assigneesOf(task.id)).toEqual([people.producer, people.superadmin, people.invited].sort());
      expect(await inboxCount(people.invited)).toBe(1);

      // Removing the invitation of someone outside the department ends their access to the public project.
      await removeProjectMember(contexts.producer, publicProject.id, people.invited);
      expect(await assigneesOf(task.id)).toEqual([people.producer, people.superadmin].sort());
      expect(await inboxCount(people.invited)).toBe(0);
    });
  });
});
