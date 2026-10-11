import type { Response } from "express";

import { customFieldEmptyValue, type CustomFieldFilter } from "../../contracts/production-catalog.js";
import type { JobQuery, JobSummary } from "../../contracts/production-jobs.js";
import {
  reportDimensionInfo,
  reportMeasureInfo,
  type ReportConfig,
  type ReportFilters,
  type ReportRangePreset
} from "../../contracts/production-reports.js";
import { getSql } from "../../db/client.js";
import type { QuerySql } from "../../lib/db-types.js";
import type { AccessContext } from "../access/access-context.js";
import { businessDate, dayCell, exportFilename, numberFormats, percentCell, sendWorkbook, type CellValue, type SheetColumn, type SheetSpec } from "./excel.js";
import { listJobs } from "./jobs.service.js";
import { getKpiReport } from "./kpi-settlement.service.js";
import { loadReportCustomFields, runReport, type ReportCustomFields } from "./reports.js";
import { getScoreBoard } from "./scores.service.js";
import { businessDay } from "./time.js";

/**
 * Excel exports (SPEC Phase 5 §4 and §6): the report builder (data + config sheets), the filtered job
 * list, the public score board and the KPI report. Every export reuses the screen's own query and
 * permission rules, loads everything first, then streams the workbook.
 */

const org = (context: AccessContext) => context.organization.id;
const exportRowLimit = 5000;

const formatDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const exportedAt = () => {
  const now = new Date();
  return { now, today: businessDay(now) };
};

const infoSheet = (rows: [string, CellValue][]): SheetSpec => ({
  name: "Thông tin",
  columns: [
    { header: "Mục", key: "item", width: 28 },
    { header: "Giá trị", key: "value", width: 80 }
  ],
  rows: rows.map(([item, value]) => ({ item, value }))
});

const exporterRows = (context: AccessContext, now: Date): [string, CellValue][] => [
  ["Người xuất", context.user.displayName],
  ["Thời điểm xuất", businessDate(now)]
];

// Report builder -------------------------------------------------------------------------------------

const presetLabels: Record<ReportRangePreset, string> = {
  TODAY: "Hôm nay",
  YESTERDAY: "Hôm qua",
  THIS_WEEK: "Tuần này",
  LAST_WEEK: "Tuần trước",
  LAST_7_DAYS: "7 ngày qua",
  LAST_30_DAYS: "30 ngày qua",
  THIS_MONTH: "Tháng này",
  LAST_MONTH: "Tháng trước",
  THIS_PERIOD: "Kỳ KPI hiện tại",
  LAST_PERIOD: "Kỳ KPI trước"
};
const taskDateLabels: Record<ReportConfig["taskDate"], string> = { DONE: "Ngày Done lần đầu", ASSIGNED: "Ngày giao", DEADLINE: "Deadline" };

type NamedFilter = Exclude<keyof ReportFilters, "taskKind" | "scoreRole" | "taskState" | "jobState" | "customFields"> | "tag";
const filterLookups: Record<NamedFilter, { label: string; query: (sql: QuerySql, organizationId: string, ids: string[]) => Promise<{ name: string }[]> }> = {
  user: {
    label: "Nhân viên",
    // Only people of this organization (any membership status: former staff still appear in reports, SEC2-27).
    query: (sql, organizationId, ids) =>
      sql<{ name: string }[]>`
        SELECT au.display_name AS name FROM public.app_users au
        WHERE au.id = ANY(${ids}::uuid[])
          AND EXISTS (SELECT 1 FROM public.organization_memberships om WHERE om.organization_id = ${organizationId} AND om.user_id = au.id)
        ORDER BY 1`
  },
  team: {
    label: "Team",
    query: (sql, organizationId, ids) =>
      sql<{ name: string }[]>`SELECT name FROM production.teams WHERE organization_id = ${organizationId} AND id = ANY(${ids}::uuid[]) ORDER BY 1`
  },
  project: {
    label: "Dự án",
    query: (sql, organizationId, ids) =>
      sql<{ name: string }[]>`SELECT code AS name FROM production.projects WHERE organization_id = ${organizationId} AND id = ANY(${ids}::uuid[]) ORDER BY 1`
  },
  client: {
    label: "Client",
    query: (sql, organizationId, ids) =>
      sql<{ name: string }[]>`SELECT name FROM production.clients WHERE organization_id = ${organizationId} AND id = ANY(${ids}::uuid[]) ORDER BY 1`
  },
  process: {
    label: "Quy trình",
    query: (sql, organizationId, ids) =>
      sql<{ name: string }[]>`SELECT name FROM production.processes WHERE organization_id = ${organizationId} AND id = ANY(${ids}::uuid[]) ORDER BY 1`
  },
  shift: {
    label: "Ca",
    query: (sql, organizationId, ids) =>
      sql<{ name: string }[]>`SELECT name FROM production.shifts WHERE organization_id = ${organizationId} AND id = ANY(${ids}::uuid[]) ORDER BY 1`
  },
  status: {
    label: "Trạng thái",
    query: (sql, organizationId, ids) =>
      sql<{ name: string }[]>`SELECT name FROM production.statuses WHERE organization_id = ${organizationId} AND id = ANY(${ids}::uuid[]) ORDER BY 1`
  },
  job: {
    label: "Job",
    query: (sql, organizationId, ids) =>
      sql<{ name: string }[]>`SELECT code AS name FROM production.jobs WHERE organization_id = ${organizationId} AND id = ANY(${ids}::uuid[]) ORDER BY 1`
  },
  tag: {
    label: "Tag",
    query: (sql, organizationId, ids) =>
      sql<{ name: string }[]>`SELECT name FROM production.tags WHERE organization_id = ${organizationId} AND id = ANY(${ids}::uuid[]) ORDER BY 1`
  }
};

const filterRows = async (sql: QuerySql, organizationId: string, filters: ReportFilters, customFields?: ReportCustomFields): Promise<[string, CellValue][]> => {
  const rows: [string, CellValue][] = [];
  for (const [key, lookup] of Object.entries(filterLookups) as [NamedFilter, (typeof filterLookups)[NamedFilter]][]) {
    const ids = filters[key];
    if (ids && ids.length > 0) {
      const names = await lookup.query(sql, organizationId, ids);
      rows.push([`Lọc – ${lookup.label}`, names.map((row) => row.name).join(", ")]);
    }
  }
  if (filters.taskKind?.length) {
    const labels = { NORMAL: "Thường", FB_WRONG: "FB sai", FB_EXTRA: "FB thêm" } as const;
    rows.push(["Lọc – Loại task", filters.taskKind.map((kind) => labels[kind]).join(", ")]);
  }
  if (filters.scoreRole?.length) {
    rows.push(["Lọc – Vai trò ghi điểm", filters.scoreRole.map((role) => (role === "WORKER" ? "Nhân viên" : "QC")).join(", ")]);
  }
  if (filters.taskState) {
    rows.push(["Lọc – Tình trạng task", filters.taskState === "OPEN" ? "Chưa Done" : "Đã Done"]);
  }
  if (filters.jobState) {
    rows.push(["Lọc – Job", filters.jobState === "ACTIVE" ? "Chưa lưu trữ" : "Đã lưu trữ"]);
  }
  for (const filter of filters.customFields ?? []) {
    const field = customFields?.get(filter.field);
    const labelOf = (value: string) => (value === customFieldEmptyValue ? "(chưa có)" : (field?.options.find((option) => option.value === value)?.label ?? value));
    rows.push([`Lọc – ${field?.label ?? filter.field}`, filter.values.map(labelOf).join(", ")]);
  }
  return rows;
};

/** POST /production/reports/export — same permissions as the query. */
export const exportReport = async (context: AccessContext, res: Response, input: { config: ReportConfig; name?: string | undefined }) => {
  const result = await runReport(context, input.config);
  const sql = getSql();
  const { now, today } = exportedAt();
  const config = result.config;
  // Column labels come with the result (custom-field dimensions carry their field label).
  const columnLabel = new Map(result.columns.map((column) => [column.key, column.label]));
  const headerOf = (dim: string) => columnLabel.get(dim) ?? dim;
  const customFields = await loadReportCustomFields(sql, org(context), config);

  const columns: SheetColumn[] = [
    ...config.dimensions.map((dim): SheetColumn => {
      if (dim === "day" || dim === "week") {
        return { header: dim === "week" ? "Tuần (từ thứ Hai)" : reportDimensionInfo[dim].label, key: dim, width: 16, numFmt: numberFormats.day };
      }
      return { header: headerOf(dim), key: dim, width: 28 };
    }),
    ...config.measures.map((measure): SheetColumn => ({
      header: reportMeasureInfo[measure].label,
      key: measure,
      width: 18,
      numFmt: numberFormats[reportMeasureInfo[measure].format as keyof typeof numberFormats] ?? numberFormats.decimal
    }))
  ];
  const dataRows: Record<string, CellValue>[] = result.rows.map((row) => {
    const out: Record<string, CellValue> = {};
    for (const dim of config.dimensions) {
      const key = row[dim];
      out[dim] = dim === "day" || dim === "week" ? dayCell(typeof key === "string" ? key : null) : row[`${dim}_label`];
    }
    for (const measure of config.measures) {
      const value = row[measure];
      out[measure] = reportMeasureInfo[measure].format === "percent" && typeof value === "number" ? percentCell(value) : value;
    }
    return out;
  });
  const hasTotals = config.dimensions.length > 0;
  if (hasTotals) {
    const totals: Record<string, CellValue> = Object.fromEntries(
      config.measures.map((measure) => [measure, reportMeasureInfo[measure].format === "percent" ? percentCell(result.totals[measure]) : result.totals[measure]])
    );
    const first = config.dimensions[0]!;
    totals[first] = first === "day" || first === "week" ? null : "Tổng cộng";
    dataRows.push(totals);
  }

  const name = input.name ?? "Báo cáo";
  const configRows: [string, CellValue][] = [
    ["Tên báo cáo", name],
    ["Khoảng ngày", `${formatDay(result.from)} – ${formatDay(result.to)}`],
    ["Kỳ có sẵn", config.preset ? presetLabels[config.preset] : config.from ? "Tuỳ chọn" : presetLabels.THIS_PERIOD],
    ["Chiều", config.dimensions.map(headerOf).join(", ") || "(không)"],
    ["Chỉ số", config.measures.map((measure) => reportMeasureInfo[measure].label).join(", ")],
    ["Mốc ngày của task", taskDateLabels[config.taskDate]],
    ...(await filterRows(sql, org(context), config.filters, customFields)),
    [
      "Sắp xếp",
      config.sort
        ? `${columnLabel.get(config.sort.key) ?? config.sort.key} ${config.sort.direction === "asc" ? "tăng dần" : "giảm dần"}`
        : "Mặc định"
    ],
    ["Số dòng", result.rows.length],
    ["Bị cắt bớt", result.truncated ? `Có (tối đa ${result.rowLimit} dòng)` : "Không"],
    ...exporterRows(context, now),
    ["Cấu hình (JSON)", JSON.stringify(config)]
  ];

  await sendWorkbook(res, exportFilename(name, `${result.from}_${result.to}`, today), [
    { name: "Dữ liệu", columns, rows: dataRows, boldLastRow: hasTotals },
    { ...infoSheet(configRows), name: "Cấu hình" }
  ]);
};

// Custom fields in exports -----------------------------------------------------------------------------

type ExportField = {
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "SELECT" | "MULTISELECT";
  options: { value: string; label: string }[];
  show_in_table: boolean;
};

const loadExportFields = (sql: QuerySql, organizationId: string, entity: "JOB" | "TASK" | "USER" | "CLIENT") => sql<ExportField[]>`
  SELECT key, label, type, options, show_in_table FROM production.custom_fields
  WHERE organization_id = ${organizationId} AND entity = ${entity} AND active
  ORDER BY sort_order, key
`;

const optionLabel = (field: ExportField, value: string) => field.options.find((option) => option.value === value)?.label ?? value;

/** A stored custom value as an Excel cell (option labels, dd/mm/yyyy days, numbers as numbers). */
const customValueCell = (field: ExportField, value: unknown): CellValue => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  switch (field.type) {
    case "NUMBER":
      return typeof value === "number" ? value : Number(value);
    case "DATE":
      return typeof value === "string" ? formatDay(value) : null;
    case "SELECT":
      return typeof value === "string" ? optionLabel(field, value) : null;
    case "MULTISELECT":
      return Array.isArray(value) ? value.map((item) => optionLabel(field, String(item))).join(", ") : null;
    default:
      return typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value);
  }
};

/** "Lọc – <field>" rows of the info sheet for custom-field filters (cf.<key>=…). */
const customFilterRows = (fields: readonly ExportField[], filters: readonly CustomFieldFilter[] | undefined): [string, CellValue][] =>
  (filters ?? []).map((filter) => {
    const field = fields.find((item) => item.key === filter.key);
    const values = filter.values.map((value) => (value === customFieldEmptyValue ? "(chưa có)" : field ? optionLabel(field, value) : value));
    const range = [filter.from ? `từ ${filter.from}` : null, filter.to ? `đến ${filter.to}` : null].filter(Boolean).join(" ");
    return [`Lọc – ${field?.label ?? filter.key}`, [...values, ...(range ? [range] : [])].join(", ")];
  });

// Jobs -------------------------------------------------------------------------------------------------

/** GET /production/jobs/export — the GET /production/jobs filters (all pages, at most 5000 jobs). */
export const exportJobs = async (context: AccessContext, res: Response, query: JobQuery) => {
  const items: JobSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await listJobs(context, { ...query, limit: 100, cursor });
    items.push(...page.items);
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor && items.length < exportRowLimit);
  const truncated = items.length > exportRowLimit || cursor !== undefined;
  const { now, today } = exportedAt();
  const fields = await loadExportFields(getSql(), org(context), "JOB");
  const tableFields = fields.filter((field) => field.show_in_table);

  const columns: SheetColumn[] = [
    { header: "Mã job", key: "code", width: 36 },
    { header: "Tên job", key: "name", width: 32 },
    { header: "Dự án", key: "project", width: 14 },
    { header: "Client", key: "client", width: 20 },
    { header: "Leader", key: "leader", width: 22 },
    { header: "Deadline", key: "deadline", width: 18, numFmt: numberFormats.datetime },
    { header: "Tổng tấm", key: "totalImages", numFmt: numberFormats.images },
    { header: "Đã giao", key: "qtyAssigned", numFmt: numberFormats.images },
    { header: "Đã done", key: "qtyDone", numFmt: numberFormats.images },
    { header: "Đã checked", key: "qtyChecked", numFmt: numberFormats.images },
    { header: "Số task", key: "taskCount", numFmt: numberFormats.count },
    { header: "Task trễ", key: "lateTaskCount", numFmt: numberFormats.count },
    { header: "FB đang mở", key: "openFeedbackCount", numFmt: numberFormats.count },
    { header: "Trạng thái", key: "status", width: 18 },
    { header: "Ngày tạo", key: "createdAt", width: 18, numFmt: numberFormats.datetime },
    { header: "Lưu trữ", key: "archived", width: 10 },
    // PLAN §8: the JOB custom fields shown in the table are columns of the export too (e.g. "Mã đơn hàng").
    ...tableFields.map((field): SheetColumn => ({ header: field.label, key: `cf_${field.key}`, width: field.type === "TEXT" ? 28 : 18 }))
  ];
  const rows = items.slice(0, exportRowLimit).map((job) => ({
    ...Object.fromEntries(tableFields.map((field) => [`cf_${field.key}`, customValueCell(field, job.customValues[field.key])])),
    code: job.code,
    name: job.name,
    project: job.project.code,
    client: job.project.clientName,
    leader: job.leader.displayName,
    deadline: businessDate(job.deadline),
    totalImages: job.totalImages,
    qtyAssigned: job.qtyAssigned,
    qtyDone: job.qtyDone,
    qtyChecked: job.qtyChecked,
    taskCount: job.taskCount,
    lateTaskCount: job.lateTaskCount,
    openFeedbackCount: job.openFeedbackCount,
    status: job.status?.name ?? "Chưa chia",
    createdAt: businessDate(job.createdAt),
    archived: job.archived ? "Có" : "Không"
  }));
  const sql = getSql();
  const nameOf = async (lookup: NamedFilter, id: string | undefined) =>
    id ? ((await filterLookups[lookup].query(sql, org(context), [id]))[0]?.name ?? id) : null;
  const filters: [string, CellValue][] = [];
  if (query.q) filters.push(["Tìm kiếm", query.q]);
  if (query.projectId) filters.push(["Lọc – Dự án", await nameOf("project", query.projectId)]);
  if (query.statusId) filters.push(["Lọc – Trạng thái", await nameOf("status", query.statusId)]);
  if (query.leaderId) filters.push(["Lọc – Leader", await nameOf("user", query.leaderId)]);
  if (query.tagId?.length) filters.push(["Lọc – Tag", (await filterLookups.tag.query(sql, org(context), query.tagId)).map((row) => row.name).join(", ")]);
  if (query.deadlineFrom) filters.push(["Deadline từ", businessDate(query.deadlineFrom)]);
  if (query.deadlineTo) filters.push(["Deadline trước", businessDate(query.deadlineTo)]);
  if (query.late) filters.push(["Chỉ job có task trễ", "Có"]);
  if (query.includeArchived) filters.push(["Gồm job đã lưu trữ", "Có"]);
  filters.push(...customFilterRows(fields, query.cf));

  await sendWorkbook(res, exportFilename("Danh sách job", null, today), [
    { name: "Job", columns, rows },
    infoSheet([...filters, ["Số job", rows.length], ["Bị cắt bớt", truncated ? `Có (tối đa ${exportRowLimit} job)` : "Không"], ...exporterRows(context, now)])
  ]);
};

// Score board ----------------------------------------------------------------------------------------------

/** GET /production/scores/board/export — the board's own visibility rules (private board → 403, money). */
export const exportScoreBoard = async (
  context: AccessContext,
  res: Response,
  query: { period?: string | undefined; teamId?: string | undefined; tagId?: string[] | undefined; cf?: CustomFieldFilter[] | undefined }
) => {
  const board = await getScoreBoard(context, query);
  const peopleFilters = await peopleFilterRows(context, query);
  const { now, today } = exportedAt();
  const showMoney = board.items.some((item) => item.money !== null);
  const columns: SheetColumn[] = [
    { header: "Hạng", key: "rank", width: 8, numFmt: numberFormats.count },
    { header: "Nhân viên", key: "name", width: 28 },
    { header: "Team", key: "team", width: 20 },
    { header: "Điểm chính thức", key: "pointsOfficial", width: 18, numFmt: numberFormats.points },
    { header: "Điểm khoán", key: "pointsKhoan", width: 14, numFmt: numberFormats.points },
    { header: "Số tấm khoán", key: "qtyKhoan", width: 14, numFmt: numberFormats.images },
    ...(showMoney ? [{ header: "Tiền khoán tạm tính (VND)", key: "money", width: 24, numFmt: numberFormats.money }] : [])
  ];
  const rows = board.items.map((item) => ({
    rank: item.rank,
    name: item.user.displayName,
    team: item.teamName ?? "",
    pointsOfficial: item.pointsOfficial,
    pointsKhoan: item.pointsKhoan,
    qtyKhoan: item.qtyKhoan,
    money: item.money
  }));
  await sendWorkbook(res, exportFilename("Bảng điểm", `kỳ ${board.period}`, today), [
    { name: "Bảng điểm", columns, rows },
    infoSheet([
      ["Kỳ KPI", board.period],
      ["Khoảng ngày", `${formatDay(board.from)} – ${formatDay(board.to)}`],
      ...peopleFilters,
      ["Số người", rows.length],
      ...exporterRows(context, now)
    ])
  ]);
};

/** Info rows for the people filters of the board / KPI exports (team, USER tags, USER custom fields). */
const peopleFilterRows = async (
  context: AccessContext,
  query: { teamId?: string | undefined; tagId?: string[] | undefined; cf?: CustomFieldFilter[] | undefined }
): Promise<[string, CellValue][]> => {
  const sql = getSql();
  const rows: [string, CellValue][] = [];
  if (query.teamId) {
    rows.push(["Lọc – Team", (await filterLookups.team.query(sql, org(context), [query.teamId]))[0]?.name ?? query.teamId]);
  }
  if (query.tagId?.length) {
    rows.push(["Lọc – Tag", (await filterLookups.tag.query(sql, org(context), query.tagId)).map((row) => row.name).join(", ")]);
  }
  if (query.cf?.length) {
    rows.push(...customFilterRows(await loadExportFields(sql, org(context), "USER"), query.cf));
  }
  return rows;
};

// KPI ------------------------------------------------------------------------------------------------------

/**
 * GET /production/kpi/export — the Phase 6 KPI report (GET /production/kpi/report, same query and
 * visibility: ADMIN every person, others only themselves; Khoán money only for ADMIN and the owner).
 * One sheet per user × period, one for the quarter / year rollups (whole quarters / years, G8) and, for an
 * Admin, one with the team and organization totals per period / quarter / year.
 */
export const exportKpi = async (
  context: AccessContext,
  res: Response,
  query: { from: string; to: string; teamId?: string | undefined; tagId?: string[] | undefined; cf?: CustomFieldFilter[] | undefined }
) => {
  const report = await getKpiReport(context, query);
  const peopleFilters = await peopleFilterRows(context, query);
  const { now, today } = exportedAt();
  const people = new Map(report.users.map((entry) => [entry.user.id, entry]));
  const person = (userId: string) => people.get(userId);
  const showMoney = report.rows.some((row) => row.khoanMoney !== null) || report.rollups.some((row) => row.khoanMoney !== null);
  const money: SheetColumn[] = showMoney ? [{ header: "Tiền khoán (VND)", key: "khoanMoney", width: 18, numFmt: numberFormats.money }] : [];
  const figures: SheetColumn[] = [
    { header: "Chỉ tiêu KPI", key: "target", width: 14, numFmt: numberFormats.points },
    { header: "Điểm chính thức", key: "pointsOfficial", width: 16, numFmt: numberFormats.points },
    { header: "Điểm khoán quy đổi", key: "khoanPointsConverted", width: 18, numFmt: numberFormats.points },
    { header: "Tổng điểm", key: "totalPoints", width: 14, numFmt: numberFormats.points },
    { header: "% đạt", key: "percent", width: 10, numFmt: numberFormats.percent },
    { header: "Vượt / thiếu", key: "difference", width: 14, numFmt: numberFormats.points }
  ];
  // Percent points with 2 decimals → a fraction for the "0.00%" cell, without float tails (PR-25).
  const percentOf = (value: number | null) => (value === null ? null : percentCell(value / 100));

  const monthly: SheetSpec = {
    name: "KPI theo kỳ",
    columns: [
      { header: "Nhân viên", key: "name", width: 28 },
      { header: "Team", key: "team", width: 20 },
      { header: "Kỳ", key: "period", width: 10 },
      { header: "Tình trạng", key: "settled", width: 12 },
      { header: "Chỉ tiêu gốc", key: "targetBase", width: 14, numFmt: numberFormats.points },
      { header: "Ngày nghỉ", key: "leaveDays", width: 10, numFmt: numberFormats.decimal },
      ...figures.slice(0, 2),
      { header: "Điểm khoán", key: "khoanCredits", width: 12, numFmt: numberFormats.points },
      ...figures.slice(2),
      { header: "Đạt KPI", key: "met", width: 10 },
      ...money
    ],
    rows: report.rows.map((row) => ({
      name: person(row.userId)?.user.displayName ?? row.userId,
      team: person(row.userId)?.teamName ?? "",
      period: row.period,
      settled: row.settled ? "Đã chốt" : "Tạm tính",
      targetBase: row.targetBase,
      leaveDays: row.leaveDays,
      target: row.target,
      pointsOfficial: row.pointsOfficial,
      khoanCredits: row.khoanCredits,
      khoanPointsConverted: row.khoanPointsConverted,
      totalPoints: row.totalPoints,
      percent: percentOf(row.percent),
      difference: row.difference,
      met: row.met ? "Có" : "Không",
      khoanMoney: row.khoanMoney
    }))
  };
  const rollups: SheetSpec = {
    name: "Theo quý - năm",
    columns: [
      { header: "Nhân viên", key: "name", width: 28 },
      { header: "Team", key: "team", width: 20 },
      { header: "Loại", key: "type", width: 8 },
      { header: "Kỳ", key: "key", width: 10 },
      { header: "Các tháng", key: "periods", width: 30 },
      { header: "Tình trạng", key: "state", width: 16 },
      { header: "Chỉ tiêu riêng", key: "explicit", width: 14 },
      ...figures,
      ...money
    ],
    rows: report.rollups.map((row) => ({
      name: person(row.userId)?.user.displayName ?? row.userId,
      team: person(row.userId)?.teamName ?? "",
      type: row.periodType === "QUARTER" ? "Quý" : "Năm",
      key: row.key,
      periods: row.periods.join(", "),
      state: rollupState(row),
      explicit: row.explicitTarget ? "Có" : "Không (cộng các tháng)",
      target: row.target,
      pointsOfficial: row.pointsOfficial,
      khoanPointsConverted: row.khoanPointsConverted,
      totalPoints: row.totalPoints,
      percent: percentOf(row.percent),
      difference: row.difference,
      khoanMoney: row.khoanMoney
    }))
  };
  const totalTypes = { MONTH: "Tháng", QUARTER: "Quý", YEAR: "Năm" } as const;
  const totals: SheetSpec = {
    name: "Tổng theo team",
    columns: [
      { header: "Nhóm", key: "group", width: 28 },
      { header: "Loại", key: "type", width: 8 },
      { header: "Kỳ", key: "key", width: 10 },
      { header: "Số người", key: "memberCount", width: 10, numFmt: numberFormats.count },
      { header: "Có chỉ tiêu", key: "withTargetCount", width: 12, numFmt: numberFormats.count },
      { header: "Đạt KPI", key: "metCount", width: 10, numFmt: numberFormats.count },
      ...figures,
      ...money
    ],
    rows: report.totals.map((row) => ({
      group: row.scope === "ORG" ? "Toàn bộ" : (row.teamName ?? "Chưa có team"),
      type: totalTypes[row.periodType],
      key: row.key,
      memberCount: row.memberCount,
      withTargetCount: row.withTargetCount,
      metCount: row.metCount,
      target: row.target,
      pointsOfficial: row.pointsOfficial,
      khoanPointsConverted: row.khoanPointsConverted,
      totalPoints: row.totalPoints,
      percent: percentOf(row.percent),
      difference: row.difference,
      khoanMoney: row.khoanMoney
    }))
  };
  const scope = report.from === report.to ? `kỳ ${report.from}` : `${report.from}_${report.to}`;
  await sendWorkbook(res, exportFilename("KPI", scope, today), [
    monthly,
    rollups,
    ...(report.totals.length > 0 ? [totals] : []),
    infoSheet([
      ["Từ kỳ", report.from],
      ["Đến kỳ", report.to],
      ...peopleFilters,
      ["Số người", report.users.length],
      ["Quý / năm", "Cả quý / cả năm: cộng các kỳ tháng đã bắt đầu (kể cả ngoài khoảng chọn), so với chỉ tiêu quý / năm hoặc tổng chỉ tiêu các tháng"],
      ...exporterRows(context, now)
    ])
  ]);
};

const rollupState = (row: { complete: boolean; settled: boolean }) => (row.settled ? "Đã chốt đủ" : row.complete ? "Tạm tính" : "Chưa hết kỳ");
