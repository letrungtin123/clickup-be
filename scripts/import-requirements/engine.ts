/** Engine of scripts/import-requirements-xlsx.ts (loaded after the outbox / publisher shims are registered). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import ExcelJS from "exceljs";

import type { RichTextDoc, RichTextNode } from "../../src/contracts/rich-text.js";
import { closeDatabase, getSql } from "../../src/db/client.js";
import { closeRedis } from "../../src/lib/redis.js";
import { resolveAccessContext } from "../../src/modules/access/access-context.js";
import { createItem } from "../../src/modules/knowledge/items.service.js";
import { createSpace } from "../../src/modules/knowledge/spaces.service.js";

type Config = { requirementsFile: string; requirementsSpace?: string; projectAliases?: Record<string, string> };
type Process = { name: string; requirement: string; estimate: string };
type Project = { code: string; processes: Process[] };

const squash = (value: string) => value.replace(/[ \t]+/g, " ").trim();
const text = (cell: ExcelJS.Cell): string => {
  const value = cell.value as unknown;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && !(value instanceof Date)) {
    const record = value as Record<string, unknown>;
    if ("formula" in record || "sharedFormula" in record) return record.result === undefined || typeof record.result === "object" ? "" : String(record.result);
    if (Array.isArray(record.richText)) return (record.richText as { text: string }[]).map((part) => part.text).join("");
    if ("text" in record) return String(record.text);
    return "";
  }
  return String(value);
};

const readProjects = async (file: string): Promise<Project[]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets[0]!;
  const columns = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, column) => columns.set(squash(text(cell)), column));
  const nameColumn = columns.get("Project");
  const requirementColumn = columns.get("Yêu cầu chung");
  const estimateColumn = columns.get("Phút / hình");
  if (!nameColumn || !requirementColumn || !estimateColumn) throw new Error('Header "Project" / "Yêu cầu chung" / "Phút / hình" not found on row 1.');
  const projects: Project[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, line) => {
    if (line === 1) return;
    const name = squash(text(row.getCell(nameColumn)));
    if (!name) return;
    const requirement = text(row.getCell(requirementColumn)).replace(/\r/g, "").trim();
    const estimate = squash(text(row.getCell(estimateColumn)));
    // A project row carries only its code (the price columns are empty or formulas of nothing).
    let others = 0;
    row.eachCell((cell, column) => {
      if (column !== nameColumn && column > 2 && column !== 11 && text(cell).trim() !== "") others += 1;
    });
    if (!requirement && !estimate && others === 0) {
      projects.push({ code: name, processes: [] });
      return;
    }
    projects.at(-1)?.processes.push({ name, requirement, estimate });
  });
  return projects.filter((project) => project.processes.length > 0);
};

const para = (value: string): RichTextNode => ({ type: "paragraph", content: value ? [{ type: "text", text: value }] : [] });
const cell = (type: "tableHeader" | "tableCell", lines: string[]): RichTextNode => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content: (lines.length > 0 ? lines : [""]).map(para)
});
const linesOf = (value: string) =>
  value
    .split("\n")
    .map((line) => squash(line.replace(/^[_\-•]+\s*/, "")))
    .filter(Boolean);

const bodyOf = (project: Project, source: string): RichTextDoc => ({
  type: "doc",
  content: [
    para(`Yêu cầu xử lý ảnh của dự án ${project.code}, theo bảng credit "${source}". Thời gian là ước tính cho một hình.`),
    {
      type: "table",
      content: [
        { type: "tableRow", content: [cell("tableHeader", ["Công đoạn"]), cell("tableHeader", ["Yêu cầu"]), cell("tableHeader", ["Phút/hình (ước tính)"])] },
        ...project.processes.map((process) => ({
          type: "tableRow",
          content: [cell("tableCell", [process.name === "QC" ? "QC (Checking)" : process.name]), cell("tableCell", linesOf(process.requirement)), cell("tableCell", [process.estimate])]
        }))
      ]
    }
  ]
});

export const main = async (argv: string[]) => {
  const configIndex = argv.indexOf("--config");
  if (configIndex < 0 || !argv[configIndex + 1]) throw new Error("Usage: --config <file.json> [--dry-run]");
  const dryRun = argv.includes("--dry-run");
  const config = JSON.parse(readFileSync(resolve(argv[configIndex + 1]!), "utf8")) as Config;
  const sql = getSql();
  try {
    const projects = await readProjects(config.requirementsFile);
    const source = config.requirementsFile.split(/[\\/]/).pop()!.replace(/\.xlsx$/i, "");
    const organizationId = (await sql<{ id: string }[]>`SELECT id FROM public.organizations WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`)[0]!.id;
    const codes = new Map(
      (await sql<{ code: string }[]>`SELECT code FROM production.projects WHERE organization_id = ${organizationId}`).map((row) => [row.code.toLowerCase(), row.code])
    );
    const codeOf = (raw: string) => {
      const aliased = config.projectAliases?.[raw] ?? raw;
      return codes.get(aliased.toLowerCase()) ?? aliased;
    };
    console.log(`${projects.length} projects with requirements: ${projects.map((project) => `${codeOf(project.code)} (${project.processes.length})`).join(", ")}`);
    const unknown = projects.filter((project) => !codes.has(codeOf(project.code).toLowerCase())).map((project) => project.code);
    if (unknown.length > 0) console.log(`Not a production project code: ${unknown.join(", ")}`);
    if (dryRun) return;

    const ownerId = (
      await sql<{ user_id: string }[]>`
        SELECT om.user_id FROM public.organization_memberships om
        JOIN public.roles r ON r.id = om.role_id AND r.key = 'superadmin'
        WHERE om.organization_id = ${organizationId} AND om.deleted_at IS NULL AND om.status = 'active'
        ORDER BY om.created_at LIMIT 1
      `
    )[0]!.user_id;
    const owner = await resolveAccessContext(ownerId);
    const spaceName = config.requirementsSpace ?? "Yêu cầu khách hàng";
    let space = (
      await sql<{ id: string }[]>`SELECT id FROM knowledge.spaces WHERE organization_id = ${organizationId} AND name = ${spaceName} AND deleted_at IS NULL`
    )[0];
    if (!space) {
      const created = await createSpace(owner, {
        name: spaceName,
        description: "Yêu cầu xử lý ảnh theo từng dự án (khách hàng): công đoạn, yêu cầu, thời gian ước tính mỗi hình.",
        visibility: "public",
        color: "violet" as never,
        icon: "book" as never,
        approvalRequired: false
      });
      space = { id: created.id };
    }
    const published = (
      await sql<{ id: string }[]>`
        SELECT id FROM knowledge.statuses WHERE organization_id = ${organizationId} AND space_id = ${space.id} AND status_group = 'active' ORDER BY position LIMIT 1
      `
    )[0]!.id;
    const existing = new Set(
      (await sql<{ title: string }[]>`SELECT title FROM knowledge.items WHERE organization_id = ${organizationId} AND space_id = ${space.id} AND deleted_at IS NULL`).map((row) => row.title)
    );
    let created = 0;
    for (const project of projects) {
      const code = codeOf(project.code);
      const title = `${code} — Yêu cầu xử lý ảnh`;
      if (existing.has(title)) continue;
      await createItem(owner, space.id, {
        title,
        summary: `Công đoạn: ${project.processes.map((process) => process.name).join(", ")}`.slice(0, 400),
        body: bodyOf(project, source),
        importance: "normal",
        statusId: published,
        tags: [code],
        pinned: false
      } as Parameters<typeof createItem>[2]);
      created += 1;
    }
    console.log(`Space "${spaceName}": ${created} items created (${existing.size} already there).`);
  } finally {
    await closeDatabase();
    await closeRedis();
  }
};
