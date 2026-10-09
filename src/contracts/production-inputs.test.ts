import { describe, expect, it } from "vitest";

import { CustomValuesSchema, IsoDateInputSchema, UpsertTeamRequestSchema } from "./production-catalog.js";
import {
  CloseFeedbackRequestSchema,
  CreateProductionCommentRequestSchema,
  CreateTasksRequestSchema,
  JobQuerySchema,
  UpdateProductionTaskRequestSchema
} from "./production-jobs.js";
import { CreateLeaveRequestSchema } from "./production-leave.js";
import { CreateSavedReportRequestSchema } from "./production-reports.js";
import { KpiTargetImportRequestSchema } from "./production-scores.js";

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
