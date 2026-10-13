/** Engine of scripts/import-workspace-projects.ts (loaded after the outbox / publisher shims are registered). */
import type { RichTextDoc, RichTextNode } from "../../src/contracts/rich-text.js";
import { closeDatabase, getSql } from "../../src/db/client.js";
import { closeRedis } from "../../src/lib/redis.js";
import { resolveAccessContext } from "../../src/modules/access/access-context.js";
import { archiveProject, createList, createProject, updateList, upsertProjectMember } from "../../src/modules/work/projects.service.js";
import { loadEffectiveWorkflow } from "../../src/modules/work/statuses.service.js";
import { createTask } from "../../src/modules/work/tasks.service.js";

type ProductionProject = { id: string; code: string; active: boolean };
type JobRow = {
  id: string;
  project_id: string;
  code: string;
  leader: string;
  deadline: Date;
  created_at: Date;
  total_images: number;
  status: string | null;
  finished_at: Date | null;
};
type TaskRow = {
  id: string;
  job_id: string;
  assignee_id: string;
  assignee: string;
  qc: string | null;
  qc_id: string | null;
  process: string;
  shift: string;
  qty: number;
  assigned_at: Date;
  done_at: Date | null;
  checked_at: Date | null;
  closed_at: Date | null;
  unit_credits: string | null;
  credits: string | null;
};

const zone = "Asia/Ho_Chi_Minh";
const dayOf = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(date);
const timeOf = (date: Date) => new Intl.DateTimeFormat("vi-VN", { timeZone: zone, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
const num = (value: number) => value.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
const monthLabel = (day: string) => `T${Number(day.slice(5, 7))}/${day.slice(0, 4)}`;

/** Workspace keys are 2–12 letters/digits starting with a letter: "A&B" → "AB", "X-pro" → "XPRO"; clashes get 2, 3… */
const keyFor = (code: string, used: Set<string>) => {
  let base = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]/.test(base)) base = `P${base}`;
  if (base.length < 2) base = `${base}X`;
  base = base.slice(0, 11);
  let key = base;
  for (let suffix = 2; used.has(key); suffix += 1) key = `${base.slice(0, 12 - String(suffix).length)}${suffix}`;
  used.add(key);
  return key;
};

const para = (text: string): RichTextNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const bullets = (lines: string[]): RichTextNode => ({ type: "bulletList", content: lines.map((line) => ({ type: "listItem", content: [para(line)] })) });

export const main = async (argv: string[]) => {
  const dryRun = argv.includes("--dry-run");
  const sql = getSql();
  try {
    const organizationId = (await sql<{ id: string }[]>`SELECT id FROM public.organizations WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`)[0]!.id;
    const ownerId = (
      await sql<{ user_id: string }[]>`
        SELECT om.user_id FROM public.organization_memberships om
        JOIN public.roles r ON r.id = om.role_id AND r.key = 'superadmin'
        WHERE om.organization_id = ${organizationId} AND om.deleted_at IS NULL AND om.status = 'active'
        ORDER BY om.created_at LIMIT 1
      `
    )[0]!.user_id;
    const owner = await resolveAccessContext(ownerId);

    const projects = await sql<ProductionProject[]>`
      SELECT id, code, active FROM production.projects WHERE organization_id = ${organizationId} ORDER BY lower(code)
    `;
    const jobs = await sql<JobRow[]>`
      SELECT j.id, j.project_id, j.code, u.display_name AS leader, j.deadline, j.created_at, j.total_images, s.name AS status,
        (SELECT max(t.closed_at) FROM production.tasks t WHERE t.job_id = j.id) AS finished_at
      FROM production.jobs j
      JOIN public.app_users u ON u.id = j.leader_id
      LEFT JOIN production.statuses s ON s.id = j.status_id
      WHERE j.organization_id = ${organizationId} AND j.archived_at IS NULL
      ORDER BY j.deadline, j.code
    `;
    const tasks = await sql<TaskRow[]>`
      SELECT t.id, t.job_id, t.assignee_id, a.display_name AS assignee, q.display_name AS qc, t.qc_id, pr.name AS process, sh.name AS shift,
        coalesce(t.qty_done, t.qty_assigned) AS qty, t.assigned_at, t.done_at, t.checked_at, t.closed_at,
        (SELECT se.unit_credits::text FROM production.score_entries se WHERE se.task_id = t.id AND se.role = 'WORKER' AND se.adjusts_entry_id IS NULL LIMIT 1) AS unit_credits,
        (SELECT sum(se.credits)::text FROM production.score_entries se WHERE se.task_id = t.id AND se.role = 'WORKER') AS credits
      FROM production.tasks t
      JOIN public.app_users a ON a.id = t.assignee_id
      LEFT JOIN public.app_users q ON q.id = t.qc_id
      JOIN production.processes pr ON pr.id = t.process_id
      JOIN production.shifts sh ON sh.id = t.shift_id
      WHERE t.organization_id = ${organizationId}
      ORDER BY t.assigned_at, t.number
    `;
    const leaders = new Set(
      (await sql<{ user_id: string }[]>`SELECT user_id FROM production.user_roles WHERE organization_id = ${organizationId} AND role_code = 'LEADER'`).map((row) => row.user_id)
    );
    const tasksByJob = new Map<string, TaskRow[]>();
    for (const task of tasks) tasksByJob.set(task.job_id, [...(tasksByJob.get(task.job_id) ?? []), task]);
    const jobsByProject = new Map<string, JobRow[]>();
    for (const job of jobs) jobsByProject.set(job.project_id, [...(jobsByProject.get(job.project_id) ?? []), job]);

    const usedKeys = new Set(
      [
        ...(await sql<{ key: string }[]>`SELECT key FROM public.projects WHERE organization_id = ${organizationId}`),
        ...(await sql<{ key: string }[]>`SELECT key FROM public.project_key_aliases WHERE organization_id = ${organizationId}`)
      ].map((row) => row.key)
    );
    const existingNames = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM public.projects WHERE organization_id = ${organizationId} AND deleted_at IS NULL`).map((row) => row.name)
    );
    // Codes that already are valid keys keep them; the others ("A&B") are derived afterwards.
    const keys = new Map<string, string>();
    const plain = (code: string) => /^[A-Za-z][A-Za-z0-9]{1,11}$/.test(code);
    for (const project of [...projects.filter((item) => plain(item.code)), ...projects.filter((item) => !plain(item.code))]) {
      if (!existingNames.has(project.code)) keys.set(project.id, keyFor(project.code, usedKeys));
    }
    console.log(`${projects.length} production projects, ${jobs.length} jobs, ${tasks.length} tasks.`);
    if (dryRun) {
      console.log(projects.map((project) => `${project.code}→${keys.get(project.id) ?? "(exists)"}`).join(" "));
      return;
    }

    let createdProjects = 0;
    let createdTasks = 0;
    let createdSubtasks = 0;
    const started = Date.now();
    for (const project of projects) {
      if (existingNames.has(project.code)) continue;
      const projectJobs = jobsByProject.get(project.id) ?? [];
      const projectTasks = projectJobs.flatMap((job) => tasksByJob.get(job.id) ?? []);
      const created = await createProject(owner, {
        key: keys.get(project.id)!,
        name: project.code,
        description: `Dự án khách hàng ${project.code}. Mỗi task là một job Sản xuất (cùng mã), subtask là từng dòng công việc trong work log.`,
        visibility: "public",
        color: "indigo"
      });
      createdProjects += 1;

      // Members: who worked on or checked this code; leaders manage.
      const members = new Map<string, "submit" | "manage">();
      for (const task of projectTasks) {
        for (const id of [task.assignee_id, task.qc_id]) if (id && id !== ownerId) members.set(id, leaders.has(id) ? "manage" : "submit");
      }
      for (const id of leaders) if (id !== ownerId) members.set(id, "manage");
      for (const [userId, accessLevel] of members) await upsertProjectMember(owner, created.id, { userId, accessLevel });

      // Lists: one per month with jobs (the default list becomes the first one).
      const months = [...new Set(projectJobs.map((job) => monthLabel(dayOf(job.deadline))))];
      const lists = new Map<string, string>();
      const defaultList = created.lists[0]!;
      await updateList(owner, created.id, defaultList.id, { name: months[0] ?? "Công việc" });
      if (months[0]) lists.set(months[0], defaultList.id);
      for (const month of months.slice(1)) lists.set(month, (await createList(owner, created.id, { name: month })).id);
      const workflow = await loadEffectiveWorkflow(sql, organizationId, created.id, null);
      const done = workflow.items.find((status) => status.isDone) ?? workflow.items.at(-1)!;

      const stamps: { id: string; created: Date; completed: Date | null }[] = [];
      for (const job of projectJobs) {
        const jobTasks = tasksByJob.get(job.id) ?? [];
        const listId = lists.get(monthLabel(dayOf(job.deadline)))!;
        const finished = job.finished_at ?? job.deadline;
        const parent = await createTask(owner, created.id, {
          listId,
          title: `${job.code} · ${num(job.total_images)} tấm`,
          description: {
            type: "doc",
            content: [
              para(`Job Sản xuất ${job.code} · Leader: ${job.leader} · Tổng ${num(job.total_images)} tấm.`),
              para(`Hạn giao: ${timeOf(job.deadline)} · Trạng thái Sản xuất: ${job.status ?? "—"}${job.finished_at ? ` (${timeOf(job.finished_at)})` : ""}.`),
              bullets(jobTasks.map((task) => `${task.process} · ${num(task.qty)} tấm · ${task.assignee} (${task.shift})`))
            ]
          } as RichTextDoc,
          statusId: done.id,
          priority: "normal",
          assigneeIds: [...new Set(jobTasks.map((task) => task.assignee_id))].slice(0, 20),
          startAt: job.created_at.toISOString(),
          dueAt: job.deadline.toISOString()
        });
        stamps.push({ id: parent.id, created: job.created_at, completed: finished });
        createdTasks += 1;
        for (const task of jobTasks) {
          const lines = [
            `Người làm: ${task.assignee} · Ca: ${task.shift} · Số tấm: ${num(task.qty)}`,
            task.unit_credits ? `Credit/tấm: ${num(Number(task.unit_credits))} · Điểm: ${num(Number(task.credits ?? 0))}` : "Chưa có điểm",
            task.qc ? `QC: ${task.qc}${task.checked_at ? ` · đã kiểm ${timeOf(task.checked_at)}` : ""}` : "QC: không có dòng Checking trong work log",
            ...(task.done_at ? [`Hoàn thành: ${timeOf(task.done_at)}`] : [])
          ];
          const child = await createTask(owner, created.id, {
            listId,
            parentTaskId: parent.id,
            title: `${task.process} · ${num(task.qty)} tấm`,
            description: { type: "doc", content: lines.map(para) } as RichTextDoc,
            statusId: done.id,
            priority: "normal",
            assigneeIds: [task.assignee_id],
            startAt: task.assigned_at.toISOString(),
            dueAt: job.deadline.toISOString()
          });
          stamps.push({ id: child.id, created: task.assigned_at, completed: task.done_at ?? finished });
          createdSubtasks += 1;
        }
      }

      // Dates follow the production history (triggers off: they would stamp now()).
      const first = projectJobs[0]?.created_at ?? new Date("2026-01-01T08:00:00+07:00");
      const last = projectJobs.at(-1)?.finished_at ?? first;
      await sql.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = replica`;
        await tx`UPDATE public.projects SET created_at = ${first}, updated_at = ${last} WHERE id = ${created.id}`;
        await tx`UPDATE public.project_memberships SET created_at = ${first}, updated_at = ${first} WHERE project_id = ${created.id}`;
        await tx`UPDATE public.lists SET created_at = ${first}, updated_at = ${first} WHERE project_id = ${created.id}`;
        for (let index = 0; index < stamps.length; index += 1000) {
          const chunk = stamps.slice(index, index + 1000);
          await tx`
            UPDATE public.tasks t SET created_at = s.created, updated_at = coalesce(s.completed, s.created), completed_at = s.completed
            FROM unnest(${chunk.map((row) => row.id)}::uuid[], ${chunk.map((row) => row.created.toISOString())}::timestamptz[],
              ${chunk.map((row) => row.completed?.toISOString() ?? null)}::timestamptz[]) AS s(id, created, completed)
            WHERE t.id = s.id
          `;
        }
        await tx`
          UPDATE public.lists l SET created_at = m.first, updated_at = m.first
          FROM (SELECT list_id, min(created_at) AS first FROM public.tasks WHERE project_id = ${created.id} GROUP BY list_id) m
          WHERE m.list_id = l.id
        `;
        await tx`UPDATE public.task_assignees a SET assigned_at = t.created_at FROM public.tasks t WHERE t.id = a.task_id AND t.project_id = ${created.id}`;
        await tx`
          UPDATE public.task_activity_events e SET created_at = coalesce(t.completed_at, t.created_at)
          FROM public.tasks t WHERE t.id = e.task_id AND t.project_id = ${created.id}
        `;
        await tx`
          UPDATE public.task_activity_events e SET created_at = t.created_at
          FROM public.tasks t WHERE t.id = e.task_id AND t.project_id = ${created.id} AND e.action IN ('TASK_CREATED', 'TASK_ASSIGNEE_ADDED')
        `;
      });
      if (!project.active) await archiveProject(owner, created.id);
      console.log(`  ${project.code}: ${projectJobs.length} tasks, ${projectTasks.length} subtasks, ${members.size} members${project.active ? "" : " (archived)"} — ${Math.round((Date.now() - started) / 1000)}s`);
    }
    console.log(`Created ${createdProjects} projects, ${createdTasks} tasks, ${createdSubtasks} subtasks.`);
  } finally {
    await closeDatabase();
    await closeRedis();
  }
};
