// Cleanup helpers for the live e2e suites (LOCAL dev DB only — every statement goes through lib.mjs localSql,
// which refuses any container outside the dev compose project). Suites remove exactly what they created;
// sweepLeftovers() removes what crashed runs left behind. Every sweep is keyed on a test-only pattern AND on
// rows written by the four seeded dev accounts, so real data (superadmin, @test.local worklog seed) never matches.
import { bumpAuthz, localSql, seed, session } from "./lib.mjs";

export const quote = (text) => `'${String(text).replaceAll("'", "''")}'`;
const sqlList = (ids) => [...new Set(ids.filter(Boolean))].map(quote).join(",");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const devEmails = ["MANAGER", "MEMBER_A", "MEMBER_B", "MEMBER_C"].map((who) => seed[`SEED_${who}_EMAIL`].toLowerCase());
/** Subquery: ids of the four seeded dev accounts (the only accounts the suites act as). */
const devUsers = `(SELECT id FROM public.app_users WHERE lower(email) IN (${devEmails.map(quote).join(",")}))`;

/** Database clock, for "since" filters (outbox, rows created by this run). */
export const dbNow = () => localSql("SELECT now()")[0];

/**
 * Waits until the outbox relay has published every event written since `since`, then gives the consumers a
 * moment, so notifications produced by this run exist before cleanup deletes them (and none arrive after).
 */
export const settleOutbox = async (since, { timeoutMs = 20_000, graceMs = 1_500 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [pending] = localSql(`SELECT count(*) FROM public.outbox_events WHERE published_at IS NULL AND created_at >= ${quote(since)}::timestamptz`);
    if (pending === "0") {
      break;
    }
    await sleep(250);
  }
  await sleep(graceMs);
};

/**
 * Permanently deletes (trash purge API) every task of these projects that holds uploaded files, so the storage
 * objects are removed by the API too — a plain SQL delete would orphan them in the bucket.
 */
export const purgeTaskFiles = async (s, projectIds) => {
  const set = sqlList(projectIds);
  if (!set) return;
  for (const taskId of localSql(`SELECT DISTINCT task_id FROM public.task_attachments WHERE project_id IN (${set})`)) {
    try {
      await s.call("DELETE", `/tasks/${taskId}`); // 404 when it is already in the trash
      await s.call("DELETE", `/trash/tasks/${taskId}`);
    } catch {
      // API unreachable: the SQL purge below still removes the rows (the objects stay in the bucket).
    }
  }
};

/**
 * Hard-deletes work projects with their tasks (lists, statuses, memberships, comments, activity cascade) and every
 * notification about them. The seeded MANAGER lacks project.delete, so DELETE /projects/:id is a 403 for it.
 */
export const purgeWorkProjects = (projectIds) => {
  const ids = sqlList(projectIds);
  if (!ids) return;
  // Safety net: only projects a seeded dev account created can ever be purged here.
  const set = `SELECT id FROM public.projects WHERE id IN (${ids}) AND created_by IN ${devUsers}`;
  localSql(`
    BEGIN;
    DELETE FROM public.notifications
    WHERE project_id IN (${set}) OR task_id IN (SELECT id FROM public.tasks WHERE project_id IN (${set}));
    UPDATE public.tasks SET parent_task_id = NULL WHERE project_id IN (${set}) AND parent_task_id IS NOT NULL;
    DELETE FROM public.tasks WHERE project_id IN (${set});
    DELETE FROM public.projects WHERE id IN (${set});
    COMMIT;
  `);
  bumpAuthz();
};

/** Suite cleanup for work projects: files through the API, then wait for notifications, then hard delete. */
export const cleanupWorkProjects = async (s, projectIds, since) => {
  const ids = projectIds.filter(Boolean);
  if (ids.length === 0) return;
  await purgeTaskFiles(s, ids);
  await settleOutbox(since);
  purgeWorkProjects(ids);
};

/** Hard-deletes channels/DMs (members, messages, reactions, mentions cascade) and their notifications. */
export const purgeChannels = (channelIds) => {
  const ids = sqlList(channelIds);
  if (!ids) return;
  // Safety net: only channels/DMs a seeded dev account created can ever be purged here.
  const set = `SELECT id FROM public.channels WHERE id IN (${ids}) AND created_by IN ${devUsers}`;
  localSql(`
    BEGIN;
    DELETE FROM public.notifications WHERE channel_id IN (${set});
    DELETE FROM public.channels WHERE id IN (${set});
    COMMIT;
  `);
  bumpAuthz();
};

/**
 * Hard-deletes production projects with their jobs (tasks, logs, scores, feedback, comments, job chats),
 * credit rules, tags and the production notifications about those jobs.
 */
export const purgeProductionProjects = (projectIds) => {
  const ids = sqlList(projectIds);
  if (!ids) return;
  // Safety net: only projects shaped like the suites' fixtures (PJ… "E2E jobs …", E2E…) can ever be purged here.
  const set = sqlList(
    localSql(`SELECT id FROM production.projects WHERE id IN (${ids}) AND ((code ~ '^PJ[0-9A-Z]+$' AND name LIKE 'E2E jobs %') OR code ~ '^E2E[0-9A-Z]+$')`)
  );
  if (!set) return;
  const jobs = localSql(`SELECT id || '|' || coalesce(channel_id::text, '') FROM production.jobs WHERE project_id IN (${set})`).map((row) => row.split("|"));
  purgeChannels(jobs.map(([, channelId]) => channelId));
  const jobSet = sqlList(jobs.map(([jobId]) => jobId));
  if (jobSet) {
    // Replica mode: the score ledger and task logs are immutable by trigger (e2e fixtures only). FK actions are off
    // too, so every table that references these jobs/tasks is deleted explicitly.
    localSql(`
      BEGIN;
      SET LOCAL session_replication_role = replica;
      DELETE FROM public.notifications WHERE type LIKE 'production.%' AND payload->>'jobId' IN (${jobSet});
      DELETE FROM production.score_entries WHERE job_id IN (${jobSet});
      DELETE FROM production.task_logs WHERE job_id IN (${jobSet});
      DELETE FROM production.anomaly_reviews WHERE task_id IN (SELECT id FROM production.tasks WHERE job_id IN (${jobSet}));
      DELETE FROM production.comments WHERE job_id IN (${jobSet});
      DELETE FROM production.entity_tags WHERE entity_id IN (${jobSet});
      DELETE FROM production.feedbacks WHERE job_id IN (${jobSet});
      DELETE FROM production.tasks WHERE job_id IN (${jobSet});
      DELETE FROM production.jobs WHERE id IN (${jobSet});
      COMMIT;
    `);
  }
  localSql(`
    BEGIN;
    DELETE FROM production.entity_tags WHERE entity_id IN (${set});
    DELETE FROM production.credit_rules WHERE project_id IN (${set});
    DELETE FROM production.projects WHERE id IN (${set});
    COMMIT;
  `);
};

/** Soft-deletes accounts created by members.e2e (never the seeded dev accounts, superadmins or @test.local). */
export const softDeleteTestAccounts = (emails) => {
  const set = sqlList(emails.map((email) => email.toLowerCase()));
  if (!set) return [];
  const victims = `(
    SELECT u.id FROM public.app_users u
    WHERE u.email_normalized IN (${set}) AND u.email_normalized ~ '^(new|e2e\\.member)\\.[0-9]{13}@nesso\\.test$'
      AND u.id NOT IN ${devUsers}
      AND NOT EXISTS (
        SELECT 1 FROM public.organization_memberships om JOIN public.roles r ON r.id = om.role_id
        WHERE om.user_id = u.id AND r.key = 'superadmin'
      )
  )`;
  const rows = localSql(`
    BEGIN;
    UPDATE public.organization_memberships SET deleted_at = now(), status = 'disabled'
    WHERE user_id IN ${victims} AND deleted_at IS NULL;
    UPDATE public.app_users SET deleted_at = now() WHERE id IN ${victims} AND deleted_at IS NULL RETURNING 'account';
    COMMIT;
  `);
  bumpAuthz();
  return rows.filter((row) => row === "account");
};

const count = (rows) => rows.filter((row) => /^[0-9a-f-]{36}$/.test(row)).length;

/**
 * Removes leftovers of e2e runs that crashed before their own cleanup (and of runs from before the suites cleaned
 * up after themselves). Returns a short summary, or "" when there was nothing to remove.
 */
export const sweepLeftovers = async () => {
  const summary = [];
  const note = (label, n) => n > 0 && summary.push(`${n} ${label}`);

  // Work projects (current "E2E <suite> …" names, mine.e2e, and the names used before this sweep existed).
  const projects = localSql(`
    SELECT id FROM public.projects
    WHERE created_by IN ${devUsers} AND (
      name ~ '^E2E (tasks|projects|sidebar|search|notifications|upload-xss) '
      OR name ~ '^My tasks e2e [A-Z0-9]+$'
      OR name IN ('Task smoke', 'QA – projects private', 'QA – projects public', 'Sidebar public', 'Sidebar public (done)',
                  'Sidebar private', 'Bí mật dự án', 'Notif smoke', 'QA – upload xss')
    )
  `);
  if (projects.length > 0) {
    if (localSql(`SELECT 1 FROM public.task_attachments WHERE project_id IN (${sqlList(projects)}) LIMIT 1`).length > 0) {
      await purgeTaskFiles(await session("MANAGER"), projects);
    }
    purgeWorkProjects(projects);
    note("work projects", projects.length);
  }

  // Production projects of every production suite — jobs (PJ…), catalog (E2ECAT… and its CSV-created …NEW),
  // scores (E2ESC…), KPI (E2EKPI…), reports (E2ERP…) — with their jobs, tasks, scores, chats and prices.
  const productionProjects = localSql(`
    SELECT id FROM production.projects
    WHERE (name LIKE 'E2E jobs %' AND code ~ '^PJ[0-9A-Z]+$')
       OR (code ~ '^E2E(CAT)?[0-9A-Z]{8}(NEW)?$' AND (name = 'E2E ' || code OR name = code))
       OR (code ~ '^E2E(SC|KPI|RP)[0-9A-Z]+$' AND name ~ '^E2E (scores|KPI|reports) [0-9A-Z]+$')
  `);
  purgeProductionProjects(productionProjects);
  note("production projects", productionProjects.length);
  const catalog = localSql(`
    BEGIN;
    CREATE TEMP TABLE e2e_clients ON COMMIT DROP AS
      SELECT id FROM production.clients WHERE name ~ '^(E2E Client E2E(CAT)?[0-9A-Z]{8}|E2E report client [0-9A-Z]+)$';
    DELETE FROM production.entity_tags WHERE entity_id IN (SELECT id FROM e2e_clients);
    DELETE FROM production.clients WHERE id IN (SELECT id FROM e2e_clients) RETURNING id;
    DELETE FROM production.tags WHERE name ~ '^(e2e-E2E(CAT)?[0-9A-Z]{8}|e2e-rp-(other-)?[0-9A-Z]+)$' RETURNING id;
    DELETE FROM production.teams WHERE name ~ '^E2E (report|scores) team [0-9A-Z]+$' RETURNING id;
    DELETE FROM production.saved_reports
    WHERE owner_id IN ${devUsers} AND name ~ '^E2E (FB|FB shared|money|pin|bad) [0-9A-Z]+$' RETURNING id;
    DELETE FROM production.custom_fields WHERE entity = 'CLIENT' AND label = 'Hạng khách' AND key ~ '^(e2e_)?tier_[0-9a-z]{8}$' RETURNING id;
    DELETE FROM public.allowed_emails WHERE email ~ '^e2e\\.[0-9]{13}@nesso\\.test$' RETURNING organization_id;
    COMMIT;
  `);
  note("catalog rows", count(catalog));

  // Leave requests of production-leave (marker note, filed by dev accounts) and the notifications about them.
  const leaves = localSql(`
    BEGIN;
    CREATE TEMP TABLE e2e_leaves ON COMMIT DROP AS
      SELECT id FROM production.leave_requests WHERE note LIKE '[e2e-leave]%' AND user_id IN ${devUsers};
    DELETE FROM public.notifications
    WHERE type LIKE 'production.leave_%' AND payload->>'leaveId' IN (SELECT id::text FROM e2e_leaves);
    DELETE FROM production.leave_requests WHERE id IN (SELECT id FROM e2e_leaves) RETURNING id;
    COMMIT;
  `);
  note("leave requests", count(leaves));

  // Price versions the catalog suite's "new version from 2026-08-01" copied onto real projects: identical copies
  // written by the dev MANAGER, never used by a score. Removing one re-extends the version it split (as the API does).
  const copies = localSql(`
    BEGIN;
    CREATE TEMP TABLE e2e_copies ON COMMIT DROP AS
      SELECT c.id, c.effective_to, p.id AS previous_id
      FROM production.credit_rules c
      JOIN production.credit_rules p
        ON p.organization_id = c.organization_id AND p.project_id = c.project_id AND p.process_id = c.process_id
       AND p.effective_to = c.effective_from AND p.credit_per_image = c.credit_per_image
       AND p.money_per_image IS NOT DISTINCT FROM c.money_per_image
      WHERE c.created_by IN ${devUsers} AND c.effective_from = '2026-08-01'
        AND NOT EXISTS (SELECT 1 FROM production.score_entries s WHERE s.credit_rule_id = c.id);
    DELETE FROM production.credit_rules WHERE id IN (SELECT id FROM e2e_copies);
    UPDATE production.credit_rules r SET effective_to = e2e_copies.effective_to
    FROM e2e_copies WHERE r.id = e2e_copies.previous_id
    RETURNING r.id;
    COMMIT;
  `);
  note("copied price versions", count(copies));

  // Chat: e2e channels, job chats of e2e jobs, and the exact DM / group DM participant sets chat.e2e opens.
  const [manager, a, b, c] = devEmails.map((email) => localSql(`SELECT id FROM public.app_users WHERE lower(email) = ${quote(email)}`)[0]);
  const dmKeys = [[a, b], [a, b, c], [a, b, c, manager]].map((ids) => [...ids].sort().join(","));
  const channels = localSql(`
    SELECT id FROM public.channels
    WHERE created_by IN ${devUsers} AND (
      (kind IN ('public', 'private') AND (
        name_normalized ~ '^e2e-'
        OR name_normalized ~ '^(smoke-(pub|pub2|priv)-[a-z0-9]+|thread-test-[0-9]+)$'
        OR name ~ '^job JOB [0-9A-Z]+( \\([0-9]+\\))?$'
      ))
      OR (kind IN ('dm', 'group_dm') AND created_by = ${quote(a)} AND dm_key IN (${dmKeys.map(quote).join(",")}))
    )
  `);
  purgeChannels(channels);
  note("channels/DMs", channels.length);

  // Accounts created by members.e2e.
  const accounts = localSql(`
    SELECT email_normalized FROM public.app_users
    WHERE deleted_at IS NULL AND email_normalized ~ '^(new|e2e\\.member)\\.[0-9]{13}@nesso\\.test$'
  `);
  note("test accounts", softDeleteTestAccounts(accounts).length);

  // Notifications that point at something that no longer exists, involving a dev account (as actor or recipient).
  const dangling = localSql(`
    DELETE FROM public.notifications n
    WHERE (n.actor_user_id IN ${devUsers} OR n.recipient_user_id IN ${devUsers})
      AND (
        (n.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = n.project_id))
        OR (n.task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = n.task_id))
        OR (n.channel_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.channels ch WHERE ch.id = n.channel_id))
        OR (n.type LIKE 'production.leave_%'
            AND NOT EXISTS (SELECT 1 FROM production.leave_requests l WHERE l.id::text = n.payload->>'leaveId'))
        OR (n.type LIKE 'production.%' AND n.payload ? 'jobId'
            AND NOT EXISTS (SELECT 1 FROM production.jobs j WHERE j.id::text = n.payload->>'jobId'))
      )
    RETURNING n.id;
  `);
  note("dangling notifications", count(dangling));

  return summary.join(", ");
};
