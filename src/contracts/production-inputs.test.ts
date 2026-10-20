import { describe, expect, it } from "vitest";

import {
  CustomValuesSchema,
  defaultFeaturePermissions,
  defaultJobPermissions,
  IsoDateInputSchema,
  isKpiCloseDay,
  KhoanPayPolicySchema,
  KpiCloseDayVersionSchema,
  kpiCloseDayEndOfMonth,
  ProductionSettingsSchema,
  UpdateProductionSettingsRequestSchema,
  UpsertTeamRequestSchema
} from "./production-catalog.js";
import {
  CloseFeedbackRequestSchema,
  CreateJobRequestSchema,
  CreateProductionCommentRequestSchema,
  CreateTasksRequestSchema,
  CreateWorkEntryRequestSchema,
  JobQuerySchema,
  ProductionTaskSchema,
  UpdateProductionTaskRequestSchema,
  WorkLinkSchema
} from "./production-jobs.js";
import { CreateLeaveRequestSchema } from "./production-leave.js";
import { CreateSavedReportRequestSchema } from "./production-reports.js";
import { closingDayOfPeriod, KpiTargetImportRequestSchema } from "./production-scores.js";

// PD-036: "Phân quyền Job" — the four editable roles × view / create / update / delete, each none / own / all.
describe("job permission matrix setting", () => {
  it("accepts the full matrix only; ADMIN is not part of it", () => {
    expect(UpdateProductionSettingsRequestSchema.safeParse({ jobPermissions: defaultJobPermissions }).success).toBe(true);
    const strict = { ...defaultJobPermissions, QC: { view: "none", create: "none", update: "none", delete: "none" } };
    expect(UpdateProductionSettingsRequestSchema.safeParse({ jobPermissions: strict }).success).toBe(true);
    const withAdmin = { ...defaultJobPermissions, ADMIN: { view: "own", create: "own", update: "own", delete: "own" } };
    expect(UpdateProductionSettingsRequestSchema.safeParse({ jobPermissions: withAdmin }).success).toBe(false);
    const missingRole: Record<string, unknown> = { ...defaultJobPermissions };
    delete missingRole.STAFF;
    expect(UpdateProductionSettingsRequestSchema.safeParse({ jobPermissions: missingRole }).success).toBe(false);
    const badScope = { ...defaultJobPermissions, STAFF: { view: "mine", create: "own", update: "own", delete: "own" } };
    expect(UpdateProductionSettingsRequestSchema.safeParse({ jobPermissions: badScope }).success).toBe(false);
    const missingAction = { ...defaultJobPermissions, STAFF: { view: "own", create: "own", update: "own" } };
    expect(UpdateProductionSettingsRequestSchema.safeParse({ jobPermissions: missingAction }).success).toBe(false);
  });
});

// PD-035: the work-log fields of a line and of a job.
describe("work-log fields", () => {
  it("a line takes Ngày nhận, Ngày giao, Hình lỗi (≥ 0) and an optional Giờ OT", () => {
    const line = { assigneeId: "11111111-1111-4111-8111-111111111111", processId: "22222222-2222-4222-8222-222222222222", shiftId: "33333333-3333-4333-8333-333333333333", qtyAssigned: 4 };
    expect(CreateTasksRequestSchema.safeParse({ tasks: [{ ...line, assignedAt: "2026-10-12T00:00:00+07:00", deadline: "2026-10-12T23:59:00+07:00", errorQty: 0, otHours: 1.5 }] }).success).toBe(true);
    expect(CreateTasksRequestSchema.safeParse({ tasks: [{ ...line, errorQty: -1 }] }).success).toBe(false);
    expect(CreateTasksRequestSchema.safeParse({ tasks: [{ ...line, otHours: 0 }] }).success).toBe(false);
    expect(UpdateProductionTaskRequestSchema.safeParse({ errorQty: null, otHours: null }).success).toBe(true);
  });

  // PD-040: "Link chia việc" — any single-line text (web link or folder path), trimmed, ≤ 2000, no control characters.
  it("a line takes an optional Link chia việc: a web link or a folder path, never control characters", () => {
    const line = { assigneeId: "11111111-1111-4111-8111-111111111111", processId: "22222222-2222-4222-8222-222222222222", shiftId: "33333333-3333-4333-8333-333333333333", qtyAssigned: 4 };
    const parsed = CreateTasksRequestSchema.parse({ tasks: [{ ...line, workLink: "  https://drive.example.com/folders/abc?x=1  " }] });
    expect(parsed.tasks[0]!.workLink).toBe("https://drive.example.com/folders/abc?x=1");
    // Not only http(s): network-drive and UNC folders, Vietnamese names, spaces.
    for (const value of ["Y:\\Client\\2026\\Batch 1", "\\\\server\\share\\Lô 7", "Thư mục ảnh/Đợt 2", "ftp://files.example.com/x"]) {
      expect(WorkLinkSchema.safeParse(value).success).toBe(true);
      expect(CreateWorkEntryRequestSchema.shape.workLink.safeParse(value).success).toBe(true);
    }
    expect(CreateTasksRequestSchema.safeParse({ tasks: [line] }).success).toBe(true);
    expect(CreateTasksRequestSchema.safeParse({ tasks: [{ ...line, workLink: null }] }).success).toBe(true);
    expect(WorkLinkSchema.safeParse("x".repeat(2000)).success).toBe(true);
    expect(WorkLinkSchema.safeParse("x".repeat(2001)).success).toBe(false);
    // Surrounding whitespace / line breaks are trimmed; inside, control characters are refused (C0, DEL, C1, NUL).
    expect(WorkLinkSchema.parse("\n Y:\\Batch 1 \t")).toBe("Y:\\Batch 1");
    for (const value of ["a\tb", "a\nb", "a\u007fb", "a\u0085b", nul]) {
      expect(WorkLinkSchema.safeParse(value).success).toBe(false);
    }
    expect(UpdateProductionTaskRequestSchema.safeParse({ workLink: "Y:\\Client\\Batch 1" }).success).toBe(true);
    expect(UpdateProductionTaskRequestSchema.safeParse({ workLink: null }).success).toBe(true);
    expect(UpdateProductionTaskRequestSchema.safeParse({ workLink: "a\nb" }).success).toBe(false);
    expect(UpdateProductionTaskRequestSchema.safeParse({ workLink: 12 }).success).toBe(false);
    // The read schema carries it (null = none).
    expect(ProductionTaskSchema.shape.workLink.safeParse(null).success).toBe(true);
    expect(ProductionTaskSchema.shape.workLink.safeParse("Y:\\Client").success).toBe(true);
  });

  // PD-073: the Leader is required by the service (400 JOB_LEADER_REQUIRED, pd073.test.ts); the schema lets null through
  // so that refusal carries its own code and message.
  it("a job's Gói công việc is up to 300 characters; leader nullable in the schema; Tổng tấm optional", () => {
    const job = { projectId: "11111111-1111-4111-8111-111111111111", receivedAt: "2026-10-12T00:00:00+07:00", deadline: "2026-10-15T23:59:00+07:00" };
    expect(CreateJobRequestSchema.safeParse({ ...job, code: "x".repeat(300) }).success).toBe(true);
    expect(CreateJobRequestSchema.safeParse({ ...job, code: "x".repeat(301) }).success).toBe(false);
    expect(CreateJobRequestSchema.safeParse({ ...job, code: "A/B", leaderId: null, totalImages: null }).success).toBe(true);
    expect(CreateJobRequestSchema.safeParse({ projectId: job.projectId, code: "A/B", deadline: job.deadline }).success).toBe(false);
    expect(JobQuerySchema.safeParse({ leaderId: "none" }).success).toBe(true);
    expect(JobQuerySchema.safeParse({ leaderId: "nobody" }).success).toBe(false);
  });
});

const id = "6f1c2d3e-4a5b-4c6d-8e7f-001122334455";
const nul = "a\u0000b";

// PR-16: inputs PostgreSQL would reject (500) are refused by the contract (400).
describe("production request inputs", () => {
  it("reject the NUL character in free text, custom values, CSV and search", () => {
    expect(UpsertTeamRequestSchema.safeParse({ name: nul }).success).toBe(false);
    expect(CreateProductionCommentRequestSchema.safeParse({ body: nul }).success).toBe(false);
    expect(CloseFeedbackRequestSchema.safeParse({ note: nul }).success).toBe(false);
    expect(JobQuerySchema.safeParse({ q: nul }).success).toBe(false);
    expect(JobQuerySchema.safeParse({ cursor: nul }).success).toBe(false);
    expect(CustomValuesSchema.safeParse({ field: nul }).success).toBe(false);
    expect(CustomValuesSchema.safeParse({ [nul]: "x" }).success).toBe(false);
    expect(CustomValuesSchema.safeParse({ tags: ["ok", nul] }).success).toBe(false);
    expect(KpiTargetImportRequestSchema.safeParse({ csv: `user_email,target\n${nul},1`, period: "2026-10" }).success).toBe(false);
    expect(CreateSavedReportRequestSchema.safeParse({ name: nul, config: { measures: ["points"] } }).success).toBe(false);
    expect(CreateLeaveRequestSchema.safeParse({ fromDate: "2026-10-12", toDate: "2026-10-12", note: nul }).success).toBe(false);
    // Ordinary Vietnamese text passes (trimmed).
    expect(UpsertTeamRequestSchema.parse({ name: "  Đội ảnh 1 " }).name).toBe("Đội ảnh 1");
  });

  it("reject instants the database cannot store (year 0000, 31/02)", () => {
    expect(IsoDateInputSchema.safeParse("2026-10-10T10:00:00+07:00").success).toBe(true);
    expect(IsoDateInputSchema.safeParse("0000-01-01T00:00:00Z").success).toBe(false);
    expect(IsoDateInputSchema.safeParse("2026-02-31T00:00:00Z").success).toBe(false);
    const line = { assigneeId: id, processId: id, shiftId: id, qtyAssigned: 1 };
    expect(CreateTasksRequestSchema.safeParse({ tasks: [{ ...line, deadline: "0001-01-01T00:00:00Z" }] }).success).toBe(false);
    expect(UpdateProductionTaskRequestSchema.safeParse({ deadline: "2026-13-01T00:00:00Z" }).success).toBe(false);
    expect(JobQuerySchema.safeParse({ deadlineFrom: "9999-12-31T00:00:00Z" }).success).toBe(false);
  });
});

// PD-032 / PD-066: what PATCH /production/settings accepts for the close day; the Khoán pay policy and moneyPublic are gone.
describe("production settings: close day; no Khoán pay policy, no moneyPublic (PD-066)", () => {
  it("close day is 1–28 or 31 = “Cuối tháng”", () => {
    for (const day of [1, 20, 28, 31]) {
      expect(UpdateProductionSettingsRequestSchema.safeParse({ kpiCloseDay: day }).success, String(day)).toBe(true);
    }
    for (const day of [0, -1, 29, 30, 32, 25.5]) {
      expect(UpdateProductionSettingsRequestSchema.safeParse({ kpiCloseDay: day }).success, String(day)).toBe(false);
    }
    expect(UpdateProductionSettingsRequestSchema.safeParse({ kpiCloseDay: "31" }).success).toBe(false);
    const refused = UpdateProductionSettingsRequestSchema.safeParse({ kpiCloseDay: 30 });
    expect(refused.success ? null : refused.error.issues[0]?.message).toBe("Ngày chốt là 1–28 hoặc 31 (cuối tháng).");
    expect(KpiCloseDayVersionSchema.safeParse({ fromPeriod: "2026-11", closeDay: kpiCloseDayEndOfMonth }).success).toBe(true);
    expect(KpiCloseDayVersionSchema.safeParse({ fromPeriod: "2026-11", closeDay: 29 }).success).toBe(false);
    expect([1, 28, 31, 29, 0, 12.5].map(isKpiCloseDay)).toEqual([true, true, true, false, false, false]);
  });

  it("PD-066: the Khoán pay policy and moneyPublic are no longer settings — a PATCH naming them is refused", () => {
    for (const value of ["ALWAYS", "IF_KPI", "TOP_UP"]) {
      expect(UpdateProductionSettingsRequestSchema.safeParse({ khoanPayPolicy: value }).success, value).toBe(false);
    }
    expect(UpdateProductionSettingsRequestSchema.safeParse({ moneyPublic: true }).success).toBe(false);
    expect(UpdateProductionSettingsRequestSchema.parse({ kpiCloseDay: 31, kpiProrateLeave: true })).toEqual({ kpiCloseDay: 31, kpiProrateLeave: true });
    // Runs keep their recorded rule readable: the two retired ones and TOP_UP.
    expect(["ALWAYS", "IF_KPI", "TOP_UP"].map((value) => KhoanPayPolicySchema.safeParse(value).success)).toEqual([true, true, true]);
    const settings = {
      kpiCloseDay: 31,
      kpiCloseDays: [{ fromPeriod: null, closeDay: 25 }, { fromPeriod: "2026-11", closeDay: 31 }],
      scoresPublic: true,
      kpiProrateLeave: false,
      anomalyFailRate: 0.15,
      dueSoonHours: 2,
      kpiDefaultMember: 100,
      kpiDefaultLeader: 80,
      chatAttachmentsEnabled: true,
      jobPermissions: defaultJobPermissions,
      featurePermissions: defaultFeaturePermissions,
      timezone: "Asia/Ho_Chi_Minh"
    };
    const parsed = ProductionSettingsSchema.parse({ ...settings, moneyPublic: true, khoanPayPolicy: "ALWAYS" });
    expect("moneyPublic" in parsed || "khoanPayPolicy" in parsed).toBe(false);
  });

  it("closingDayOfPeriod clamps 31 to the month's length", () => {
    expect(closingDayOfPeriod(31, "2026-02")).toBe(28);
    expect(closingDayOfPeriod(31, "2028-02")).toBe(29);
    expect(closingDayOfPeriod(31, "2026-04")).toBe(30);
    expect(closingDayOfPeriod(31, "2026-10")).toBe(31);
    expect(closingDayOfPeriod(28, "2026-02")).toBe(28);
    expect(closingDayOfPeriod([{ fromPeriod: null, closeDay: 25 }, { fromPeriod: "2026-11", closeDay: 31 }], "2026-10")).toBe(25);
    expect(closingDayOfPeriod([{ fromPeriod: null, closeDay: 25 }, { fromPeriod: "2026-11", closeDay: 31 }], "2026-11")).toBe(30);
  });
});
