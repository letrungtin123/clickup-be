/**
 * LOCAL DEVELOPMENT ONLY — imports work logs in the company's "v2" layout (PD-035): one sheet, one row per task,
 *   Nhân viên thực hiện · Dự án · Gói công việc · Quy trình · Ngày nhận · Ngày giao · Ca làm việc · Số lượng ·
 *   Hình lỗi · Giờ OT · Ghi chú
 * Rows with the same Dự án + Gói công việc form one job whose code is the package text (PD-035). Every row is a line
 * (task), Checking rows included: the checker's QC points come from their own Checking line (PD-037), so no line gets
 * a QC assignment. Every line is replayed through the real workflow engine with the dates of its row (Ngày nhận
 * 00:00, Done 17:00 on Ngày giao) and ends Delivered; Hình lỗi is stored for review only; Giờ OT and Ghi chú are
 * optional; the job has no leader (the file has none).
 *
 *   npx tsx scripts/import-worklog-v2.ts --config <private config.json> [--dry-run]
 *
 * Config: workbooks, processAliases (lower-case source → catalog name), priceFallbacks ([{project, process, from}]:
 * a missing project × process price is created by copying every version of project × from). Accounts must already
 * exist (matched by display name); unknown project codes are created. Refuses to run when production jobs exist.
 * Company data lives only in the config and the workbooks, never in this repo.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import ExcelJS from "exceljs";

import "dotenv/config";

import { closeDatabase, getSql } from "../src/db/client.js";
import { closeRedis } from "../src/lib/redis.js";
import { type AccessContext, resolveAccessContext } from "../src/modules/access/access-context.js";
import { loadTask, loadWorkflowModel, type TaskRow } from "../src/modules/production/jobs.repo.js";
import { insertTasks, moveTask, moveTasks, settleJob } from "../src/modules/production/tasks.service.js";
import { statusByCode, type Workflow } from "../src/modules/production/workflow.js";
import { assertDevDatabase, isLoopbackUrl } from "./lib/dev-guard.js";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index]!;
  if (key.startsWith("--")) {
    args.set(key.slice(2), process.argv[index + 1] && !process.argv[index + 1]!.startsWith("--") ? process.argv[++index]! : "true");
  }
}
const configPath = args.get("config");
const dryRun = args.get("dry-run") === "true";
if (!configPath) {
  console.error("Usage: npx tsx scripts/import-worklog-v2.ts --config <file.json> [--dry-run]");
  process.exit(1);
}
if (!isLoopbackUrl(process.env.DATABASE_URL ?? "") || !isLoopbackUrl(process.env.SUPABASE_URL ?? "")) {
  console.error("Refusing to import: SUPABASE_URL and DATABASE_URL must point at the local stack.");
  process.exit(1);
}
await assertDevDatabase();

type Config = {
  workbooks: string[];
  processAliases?: Record<string, string>;
  priceFallbacks?: { project: string; process: string; from: string }[];
};
const config = JSON.parse(readFileSync(resolve(configPath), "utf8")) as Config;

const squash = (value: string) => value.replace(/\s+/g, " ").trim();
const fold = (value: string) => squash(value).toLowerCase();
const vn = (day: string, time: string) => new Date(`${day}T${time}:00+07:00`);
const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);
const processName = (raw: string) => config.processAliases?.[fold(raw)] ?? squash(raw);
const isQc = (name: string) => fold(name) === "checking";

// Reading ----------------------------------------------------------------------------------------------------------------

const cellValue = (cell: ExcelJS.Cell): unknown => {
  const value = cell.value as unknown;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const record = value as Record<string, unknown>;
    if ("formula" in record || "sharedFormula" in record) {
      return record.result && typeof record.result === "object" && !(record.result instanceof Date) ? undefined : record.result;
    }
    if (Array.isArray(record.richText)) return (record.richText as { text: string }[]).map((part) => part.text).join("");
    if ("text" in record) return record.text;
    if ("error" in record) return undefined;
  }
  return value;
};
const text = (value: unknown) => (value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : squash(String(value)));
const day = (value: unknown) => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : null);
const numberOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

const HEADERS = {
  staff: "Nhân viên thực hiện",
  project: "Dự án",
  pkg: "Gói công việc",
  process: "Quy trình",
  received: "Ngày nhận",
  delivered: "Ngày giao",
  shift: "Ca làm việc",
  qty: "Số lượng",
  errors: "Hình lỗi",
  ot: "Giờ OT",
  note: "Ghi chú"
} as const;

export type Row = {
  source: string;
  line: number;
  staff: string;
  project: string;
  pkg: string;
  process: string;
  received: string | null;
  delivered: string | null;
  rawDelivered: string;
  shift: string;
  qty: number | null;
  errors: number | null;
  ot: number | null;
  rawOt: string;
  note: string;
};

const readWorkbook = async (file: string): Promise<Row[]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const name = file.split(/[\\/]/).pop()!;
  for (const sheet of workbook.worksheets) {
    const columns = new Map<keyof typeof HEADERS, number>();
    sheet.getRow(1).eachCell((cell, column) => {
      const header = text(cellValue(cell));
      for (const [key, label] of Object.entries(HEADERS) as [keyof typeof HEADERS, string][]) {
        if (header === label || header.startsWith(`${label} (`)) columns.set(key, column);
      }
    });
    if (columns.size < Object.keys(HEADERS).length) continue;
    const rows: Row[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, line) => {
      if (line === 1) return;
      const get = (key: keyof typeof HEADERS) => cellValue(row.getCell(columns.get(key)!));
      const staff = text(get("staff"));
      if (!staff) return;
      rows.push({
        source: `${name}#${sheet.name}`,
        line,
        staff,
        project: text(get("project")),
        pkg: text(get("pkg")),
        process: processName(text(get("process"))),
        received: day(get("received")),
        delivered: day(get("delivered")),
        rawDelivered: text(get("delivered")),
        shift: text(get("shift")),
        qty: numberOrNull(get("qty")),
        errors: numberOrNull(get("errors")),
        ot: numberOrNull(get("ot")),
        rawOt: text(get("ot")),
        note: text(get("note"))
      });
    });
    return rows;
  }
  throw new Error(`${name}: no sheet with the v2 work-log header (${Object.values(HEADERS).join(", ")})`);
};

// Plan -----------------------------------------------------------------------------------------------------------------

type Work = { row: Row; day: string; assignedDay: string; checking: boolean };
type Job = { projectKey: string; pkg: string; work: Work[]; checks: { row: Row; day: string }[] };

const plan = (rows: Row[]) => {
  const notes: string[] = [];
  const jobs = new Map<string, Job>();
  for (const row of rows) {
    if (row.qty === null || row.qty <= 0) {
      notes.push(`${row.source} line ${row.line}: no quantity — skipped`);
      continue;
    }
    const delivered = row.delivered ?? row.received;
    if (!delivered) {
      notes.push(`${row.source} line ${row.line}: no date — skipped`);
      continue;
    }
    if (!row.delivered) notes.push(`${row.source} line ${row.line}: Ngày giao "${row.rawDelivered}" unreadable → Ngày nhận ${delivered}`);
    if (row.ot === null && row.rawOt) notes.push(`${row.source} line ${row.line}: Giờ OT "${row.rawOt}" is not a number — ignored`);
    const key = `${fold(row.project)}|${row.pkg}`;
    const job = jobs.get(key) ?? { projectKey: fold(row.project), pkg: row.pkg, work: [], checks: [] };
    jobs.set(key, job);
    const assignedDay = row.received && row.received <= delivered ? row.received : delivered;
    if (isQc(row.process)) job.checks.push({ row, day: delivered });
    job.work.push({ row, day: delivered, assignedDay, checking: isQc(row.process) });
  }
  const qcWanted = [...jobs.values()].reduce((sum, job) => sum + job.checks.reduce((total, check) => total + check.row.qty!, 0), 0);
  const qcOnly = [...jobs.values()].filter((job) => job.work.every((item) => item.checking));
  if (qcOnly.length > 0) notes.push(`${qcOnly.length} packages contain only Checking lines (re-checks): ${qcOnly.map((job) => job.pkg).join(" | ")}`);
  return { jobs: [...jobs.values()], notes, qcWanted };
};

// Main -----------------------------------------------------------------------------------------------------------------

const main = async () => {
  const sql = getSql();
  const organizationId = (await sql<{ id: string }[]>`SELECT id FROM public.organizations WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`)[0]!.id;
  const adminId = (
    await sql<{ user_id: string }[]>`
      SELECT om.user_id FROM public.organization_memberships om
      JOIN public.roles r ON r.id = om.role_id AND r.key = 'superadmin'
      WHERE om.organization_id = ${organizationId} AND om.deleted_at IS NULL AND om.status = 'active'
      ORDER BY om.created_at LIMIT 1
    `
  )[0]!.user_id;
  const admin: AccessContext = await resolveAccessContext(adminId);

  const rows: Row[] = [];
  for (const file of config.workbooks) rows.push(...(await readWorkbook(file)));
  const { jobs, notes, qcWanted } = plan(rows);
  const tasks = jobs.reduce((sum, job) => sum + job.work.length, 0);
  console.log(`${rows.length} rows → ${jobs.length} jobs, ${tasks} lines (${rows.filter((row) => isQc(row.process)).length} Checking lines, ${qcWanted} images).`);
  for (const line of notes) console.log(`  note: ${line}`);

  // Catalog checks: accounts, projects, processes, shifts, prices.
  const users = new Map((await sql<{ id: string; display_name: string }[]>`SELECT id, display_name FROM public.app_users WHERE deleted_at IS NULL`).map((row) => [row.display_name, row.id]));
  const missingPeople = [...new Set(rows.map((row) => row.staff))].filter((name) => !users.has(name));
  if (missingPeople.length > 0) throw new Error(`No account for: ${missingPeople.join(", ")}`);
  const projects = new Map((await sql<{ id: string; code: string }[]>`SELECT id, code FROM production.projects WHERE organization_id = ${organizationId}`).map((row) => [fold(row.code), row]));
  const newProjects = [...new Map(rows.filter((row) => !projects.has(fold(row.project))).map((row) => [fold(row.project), row.project])).values()];
  const processes = new Map((await sql<{ id: string; name: string; is_qc: boolean }[]>`SELECT id, name, is_qc FROM production.processes WHERE organization_id = ${organizationId}`).map((row) => [fold(row.name), row]));
  const unknownProcesses = [...new Set(rows.map((row) => row.process))].filter((name) => !processes.has(fold(name)));
  if (unknownProcesses.length > 0) throw new Error(`Unknown processes (add an alias or create them): ${unknownProcesses.join(", ")}`);
  const shifts = new Map((await sql<{ id: string; name: string }[]>`SELECT id, name FROM production.shifts WHERE organization_id = ${organizationId} AND active`).map((row) => [fold(row.name), row.id]));
  const unknownShifts = [...new Set(rows.map((row) => row.shift))].filter((name) => !shifts.has(fold(name)));
  if (unknownShifts.length > 0) throw new Error(`Unknown shifts: ${unknownShifts.join(", ")}`);
  console.log(`New projects: ${newProjects.join(", ") || "none"}`);
  if (dryRun) return;

  const existingJobs = (await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM production.jobs WHERE organization_id = ${organizationId}`)[0]!.count;
  if (existingJobs > 0) throw new Error(`${existingJobs} production jobs already exist — wipe them first.`);
  for (const code of newProjects) {
    await sql`INSERT INTO production.projects (organization_id, code, name, active) VALUES (${organizationId}, ${code}, ${code}, true)`;
  }
  const projectIds = new Map((await sql<{ id: string; code: string }[]>`SELECT id, code FROM production.projects WHERE organization_id = ${organizationId}`).map((row) => [fold(row.code), row.id]));

  // Price fallbacks: copy every version of project × from to project × process when the pair has no price yet.
  for (const fallback of config.priceFallbacks ?? []) {
    const projectId = projectIds.get(fold(fallback.project));
    const target = processes.get(fold(fallback.process));
    const source = processes.get(fold(fallback.from));
    if (!projectId || !target || !source) {
      console.log(`  price fallback skipped (unknown project/process): ${fallback.project} / ${fallback.process} ← ${fallback.from}`);
      continue;
    }
    const copied = await sql`
      INSERT INTO production.credit_rules (organization_id, project_id, process_id, credit_per_image, money_per_image, effective_from, effective_to, created_by)
      SELECT organization_id, project_id, ${target.id}, credit_per_image, money_per_image, effective_from, effective_to, ${adminId}
      FROM production.credit_rules
      WHERE organization_id = ${organizationId} AND project_id = ${projectId} AND process_id = ${source.id}
        AND NOT EXISTS (SELECT 1 FROM production.credit_rules WHERE organization_id = ${organizationId} AND project_id = ${projectId} AND process_id = ${target.id})
    `;
    console.log(`  price ${fallback.project} / ${fallback.process} ← ${fallback.from}: ${copied.count} version(s)`);
  }

  // Checking lines need a checker role (PD-037): QC for anyone who logged Checking rows without one.
  const checkers = [...new Set(rows.filter((row) => isQc(row.process)).map((row) => users.get(row.staff)!))];
  const addedQc = await sql`
    INSERT INTO production.user_roles (organization_id, user_id, role_code, granted_by)
    SELECT ${organizationId}, id, 'QC', ${adminId} FROM unnest(${checkers}::uuid[]) AS id
    WHERE NOT EXISTS (
      SELECT 1 FROM production.user_roles ur WHERE ur.organization_id = ${organizationId} AND ur.user_id = id AND ur.role_code IN ('QC', 'LEADER', 'ADMIN')
    )
    ON CONFLICT DO NOTHING
  `;
  if (addedQc.count > 0) console.log(`  QC role added for ${addedQc.count} checker(s).`);

  const workflow: Workflow = await loadWorkflowModel(sql, organizationId);
  const status = (code: Parameters<typeof statusByCode>[1]) => statusByCode(workflow, code);
  const firstDay = (job: Job) => job.work.reduce((min, item) => (item.assignedDay < min ? item.assignedDay : min), "9999");
  const ordered = [...jobs].sort((a, b) => firstDay(a).localeCompare(firstDay(b)) || a.pkg.localeCompare(b.pkg));
  const started = Date.now();
  let done = 0;
  for (const job of ordered) {
    const receivedDay = firstDay(job);
    const deliveryDay = job.work.reduce((max, item) => (item.day > max ? item.day : max), "0000");
    const total = job.work.reduce((sum, item) => sum + item.row.qty!, 0);
    const receivedAt = vn(receivedDay, "00:00");
    const deadline = new Date(`${deliveryDay}T23:59:00+07:00`);
    await sql.begin(async (tx) => {
      const created = (
        await tx<{ id: string }[]>`
          INSERT INTO production.jobs (organization_id, project_id, code, leader_id, received_at, deadline, total_images, total_images_manual, created_by, created_at)
          VALUES (${organizationId}, ${projectIds.get(job.projectKey)!}, ${job.pkg}, NULL, ${receivedAt}, ${deadline}, ${total}, false, ${adminId}, ${vn(receivedDay, "08:00")})
          RETURNING id
        `
      )[0]!;
      const jobForTasks = { id: created.id, leader_id: null, received_at: receivedAt, deadline, total_images: total, total_images_manual: false, qc_buffer_hours: 0 };
      const inserted: { task: TaskRow; item: Work }[] = [];
      for (let index = 0; index < job.work.length; index += 50) {
        const batch = job.work.slice(index, index + 50);
        const { ids } = await insertTasks(
          tx,
          admin,
          workflow,
          jobForTasks,
          batch.map((item) => ({
            assigneeId: users.get(item.row.staff)!,
            qcId: null,
            processId: processes.get(fold(item.row.process))!.id,
            shiftId: shifts.get(fold(item.row.shift))!,
            qtyAssigned: item.row.qty!,
            assignedAt: vn(item.assignedDay, "00:00").toISOString(),
            deadline: new Date(`${item.day}T23:59:00+07:00`).toISOString(),
            errorQty: item.row.errors,
            otHours: item.row.ot,
            ...(item.row.note ? { note: item.row.note } : {})
          })),
          { kind: "NORMAL", feedbackId: null, defaultParentId: null }
        );
        for (const [position, id] of ids.entries()) inserted.push({ task: await loadTask(tx, organizationId, id), item: batch[position]! });
      }
      let lastDone = vn(deliveryDay, "17:00");
      const finished: TaskRow[] = [];
      for (const { task: first, item } of inserted) {
        const assignee = users.get(item.row.staff)!;
        const doneAt = vn(item.day, "17:00");
        const startAt = new Date(Math.min(vn(item.assignedDay, "09:00").getTime(), addMinutes(doneAt, -30).getTime()));
        let task = await moveTask(tx, organizationId, workflow, first, status("PROCESSING"), assignee, null, { at: startAt });
        task = await moveTask(tx, organizationId, workflow, task, status("DONE"), assignee, null, {
          qtyDone: item.row.qty!,
          ...(item.row.ot !== null ? { otHours: item.row.ot } : {}),
          at: doneAt
        });
        if (doneAt > lastDone) lastDone = doneAt;
        finished.push(task);
      }
      const completeAt = addMinutes(lastDone, 60);
      let moved = await moveTasks(tx, organizationId, workflow, finished, status("COMPLETE"), adminId, null, { at: completeAt });
      moved = await moveTasks(tx, organizationId, workflow, moved, status("DELIVERING"), adminId, null, { at: addMinutes(completeAt, 5) });
      await moveTasks(tx, organizationId, workflow, moved, status("DELIVERED"), adminId, "Nhập từ work log Excel.", { at: addMinutes(completeAt, 10) });
      await settleJob(tx, organizationId, workflow, created.id);
      await tx`DELETE FROM public.outbox_events WHERE created_at = now() AND published_at IS NULL`;
    });
    done += 1;
    if (done % 100 === 0) console.log(`  ${done}/${ordered.length} jobs (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  // Line creation is logged at "now" by insertTasks; date it to the line's Ngày nhận like the rest of the history
  // (task_logs is append-only by trigger, hence the replica role for this one statement).
  await sql.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`
      UPDATE production.task_logs l SET created_at = t.assigned_at
      FROM production.tasks t
      WHERE t.organization_id = ${organizationId} AND t.id = l.task_id AND l.action = 'CREATE' AND l.created_at > t.assigned_at + interval '1 day'
    `;
  });
  console.log(`${ordered.length} jobs replayed.`);
};

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
    await closeRedis();
  });
