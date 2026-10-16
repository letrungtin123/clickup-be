import ExcelJS from "exceljs";
import type { Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessContext } from "../access/access-context.js";
import type * as NotificationsModule from "./notifications.js";

/**
 * PD-057 at the service level, without a database (fake tagged-template `sql`): only the approvers — the roles of the
 * `leave_approval` feature (PD-065; by default Quản trị, organization superadmins always) — export the attendance
 * workbook and decide leave requests; Leaders keep seeing pending requests read-only; the reason is optional again
 * (PD-065). Fake names and ids only: the repository is public.
 */
type Call = { text: string; values: unknown[] };
type Fragment = { readonly isFragment: true; text: string; values: unknown[] };

const db = vi.hoisted(() => {
  const state = {
    calls: [] as Call[],
    handler: (() => []) as (call: Call) => unknown[] | undefined
  };
  const isFragment = (value: unknown): value is Fragment =>
    typeof value === "object" && value !== null && (value as { isFragment?: unknown }).isFragment === true;
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
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
        state.calls.push(call);
        try {
          resolve(state.handler(call) ?? []);
        } catch (error) {
          reject(error);
        }
      }
    };
  };
  const fake = Object.assign(sql, {
    json: (value: unknown) => value,
    begin: <T>(fn: (tx: unknown) => Promise<T>) => fn(fake)
  });
  return { state, sql: fake };
});
const spies = vi.hoisted(() => ({ events: [] as { type: string }[] }));

vi.mock("../../lib/redis.js", () => ({
  hasRedisConfig: () => false,
  getOptionalRedis: () => undefined,
  getRedis: () => {
    throw new Error("Redis is not available in this test");
  }
}));
vi.mock("../../db/client.js", () => ({ getSql: () => db.sql }));
vi.mock("../../realtime/publisher.js", () => ({ publishToRoom: vi.fn() }));
vi.mock("./notifications.js", async (importOriginal) => ({
  ...(await importOriginal<typeof NotificationsModule>()),
  enqueueProductionEvents: vi.fn((_tx: unknown, events: { type: string }[]) => {
    spies.events.push(...events);
    return Promise.resolve();
  })
}));

const { createLeaveRequest, decideLeaveRequest, exportLeaveAttendance, listPendingLeave, getLeaveCalendar } = await import("./leave.service.js");
const { CreateLeaveRequestSchema, LeaveExportQuerySchema } = await import("../../contracts/production-leave.js");
const { defaultFeaturePermissions } = await import("../../contracts/production-catalog.js");
const { clearProductionConfigCache } = await import("./catalog-cache.js");

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const teamId = "44444444-4444-4444-8444-444444444444";
const leaveId = "55555555-5555-4555-8555-555555555555";

const contextWith = (roles: string[], options: { superadmin?: boolean; userId?: string } = {}) =>
  ({
    user: { id: options.userId ?? me, displayName: "Quản trị A" },
    organization: { id: org },
    hasFullOrganizationAuthority: options.superadmin ?? false,
    productionRoles: roles,
    role: { permissions: [] }
  }) as unknown as AccessContext;

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    const appError = error as { code?: string; statusCode?: number; message?: string };
    return { code: appError.code, status: appError.statusCode, message: appError.message };
  }
  return null;
};

const user = (id: string, name: string) => ({ id, display_name: name, email: `${id.slice(0, 4)}@example.test`, avatar_url: null });

const leaveRow = (overrides: Record<string, unknown> = {}) => ({
  id: leaveId,
  user_id: other,
  from_date: "2026-10-12",
  to_date: "2026-10-13",
  part: "FULL_DAY",
  note: "Việc gia đình",
  status: "PENDING",
  decided_at: null,
  decision_note: null,
  cancelled_at: null,
  created_at: new Date("2026-10-05T02:00:00Z"),
  updated_at: new Date("2026-10-05T02:00:00Z"),
  owner: user(other, "Nhân viên B"),
  decider: null,
  team_id: teamId,
  team_name: "Ảnh 1",
  ...overrides
});

/** A Response stand-in that keeps the status, headers and body. */
const fakeResponse = () => {
  const sent = { status: 0, headers: {} as Record<string, string>, body: null as Buffer | null };
  const res = {
    headersSent: false,
    status(code: number) {
      sent.status = code;
      return res;
    },
    setHeader(name: string, value: string) {
      sent.headers[name.toLowerCase()] = value;
    },
    end(body: Buffer) {
      sent.body = body;
      res.headersSent = true;
    }
  };
  return { res: res as unknown as Response, sent };
};

beforeEach(() => {
  db.state.calls = [];
  db.state.handler = () => [];
  spies.events = [];
  clearProductionConfigCache();
});

/** Only the settings were read (the feature matrix), nothing about leave or members. */
const readSettingsOnly = () => db.state.calls.every((call) => call.text.includes("production.settings") || call.text.includes("production.kpi_close_days"));

/** A stored feature matrix whose `leave_approval` is `roles` (answered to the settings read). */
const approvers = (roles: string[]) => (call: Call) =>
  call.text.includes("FROM production.settings")
    ? [{ key: "feature_permissions", value: { ...defaultFeaturePermissions, leave_approval: roles } }]
    : undefined;

describe("GET /production/leave/export (PD-057)", () => {
  const query = { from: "2026-10-01", to: "2026-10-31" };

  it("Leaders, Staff, Director and other roles get 403 with the Vietnamese message; non-members 404; nothing but the matrix is read", async () => {
    for (const roles of [["LEADER"], ["STAFF"], ["QC"], ["ACCOUNT"], ["DIRECTOR"], ["LEADER", "ACCOUNT", "QC", "STAFF", "DIRECTOR"]]) {
      const { res, sent } = fakeResponse();
      expect(await failure(exportLeaveAttendance(contextWith(roles), res, query))).toEqual({
        code: "FORBIDDEN",
        status: 403,
        message: "Bạn không có quyền xuất bảng chấm công nghỉ phép."
      });
      expect(sent.body).toBeNull();
    }
    expect(readSettingsOnly()).toBe(true);
    db.state.calls = [];
    const { res } = fakeResponse();
    expect(await failure(exportLeaveAttendance(contextWith([]), res, query))).toMatchObject({ code: "PRODUCTION_NOT_FOUND", status: 404 });
    expect(db.state.calls).toHaveLength(0);
  });

  it("validates the window: from ≤ to, at most 366 days (400)", async () => {
    const admin = contextWith(["ADMIN"]);
    expect(await failure(exportLeaveAttendance(admin, fakeResponse().res, { from: "2026-10-02", to: "2026-10-01" }))).toMatchObject({
      code: "LEAVE_RANGE_INVALID",
      status: 400
    });
    expect(await failure(exportLeaveAttendance(admin, fakeResponse().res, { from: "2026-01-01", to: "2027-01-02" }))).toEqual({
      code: "LEAVE_WINDOW_TOO_LONG",
      status: 400,
      message: "Chỉ xuất được tối đa 366 ngày mỗi lần."
    });
    expect(await failure(exportLeaveAttendance(admin, fakeResponse().res, { from: "2026-02-30", to: "2026-03-01" }))).toMatchObject({
      code: "LEAVE_DATE_INVALID",
      status: 400
    });
    expect(LeaveExportQuerySchema.safeParse({ from: "2026-10-01", to: "31/10/2026" }).success).toBe(false);
    expect(LeaveExportQuerySchema.safeParse({ from: "2026-10-01", to: "2026-10-31", teamId: "x" }).success).toBe(false);
    expect(readSettingsOnly()).toBe(true);
  });

  it("an unknown team is 404", async () => {
    expect(await failure(exportLeaveAttendance(contextWith(["ADMIN"]), fakeResponse().res, { ...query, teamId }))).toMatchObject({
      code: "TEAM_NOT_FOUND",
      status: 404
    });
  });

  it("ADMIN (and the organization superadmin) download the workbook: members × days from APPROVED leave + request details", async () => {
    db.state.handler = (call) => {
      if (call.text.includes("FROM production.teams WHERE")) {
        return [{ name: "Ảnh 1" }];
      }
      if (call.text.includes("FROM public.organization_memberships om")) {
        return [
          { user_id: other, display_name: "Nhân viên B", email: "b@example.test", team_name: "Ảnh 1" },
          { user_id: me, display_name: "Quản trị A", email: "a@example.test", team_name: "Ảnh 1" }
        ];
      }
      if (call.text.includes("FROM production.leave_requests lr")) {
        return [
          leaveRow({ status: "APPROVED", decided_at: new Date("2026-10-06T01:00:00Z"), decider: user(me, "Quản trị A") }),
          leaveRow({ id: "66666666-6666-4666-8666-666666666666", from_date: "2026-10-20", to_date: "2026-10-20", part: "MORNING", note: null })
        ];
      }
      return undefined;
    };
    for (const context of [contextWith(["ADMIN"]), contextWith([], { superadmin: true })]) {
      db.state.calls = [];
      const { res, sent } = fakeResponse();
      await exportLeaveAttendance(context, res, { ...query, teamId });
      expect(sent.status).toBe(200);
      expect(sent.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      expect(sent.headers["content-disposition"]).toBe(
        "attachment; filename=\"cham-cong-nghi-phep_2026-10-01_2026-10-31.xlsx\"; filename*=UTF-8''cham-cong-nghi-phep_2026-10-01_2026-10-31.xlsx"
      );
      expect(sent.headers["content-length"]).toBe(String(sent.body!.length));

      // Members: active, holding a production role, of the team; requests: APPROVED / PENDING / REJECTED overlapping the window.
      const members = db.state.calls.find((call) => call.text.includes("FROM public.organization_memberships om"))!;
      expect(members.text).toContain("om.status = 'active'");
      expect(members.text).toContain("production.user_roles");
      expect(members.values).toContain(teamId);
      const leaves = db.state.calls.find((call) => call.text.includes("FROM production.leave_requests lr"))!;
      expect(leaves.text).toContain("lr.status IN ('APPROVED', 'PENDING', 'REJECTED')");
      expect(leaves.values).toEqual(expect.arrayContaining([org, "2026-10-31", "2026-10-01", teamId]));

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(sent.body! as unknown as ArrayBuffer);
      const sheet = workbook.getWorksheet("Chấm công")!;
      expect(sheet.getCell("A1").value).toBe("BẢNG CHẤM CÔNG NGHỈ PHÉP · 01/10/2026 – 31/10/2026 · Team Ảnh 1");
      expect(sheet.getCell("A2").value).toMatch(/bởi Quản trị A\.$/);
      expect([sheet.getCell("B5").value, sheet.getCell("B6").value]).toEqual(["Nhân viên B", "Quản trị A"]);
      // 12 and 13 October approved (P); the pending morning on the 20th is not counted.
      expect([sheet.getCell(5, 3 + 12).value, sheet.getCell(5, 3 + 13).value, sheet.getCell(5, 3 + 20).value]).toEqual(["P", "P", null]);
      expect(sheet.getCell(5, 3 + 32).value).toBe(2);
      expect(sheet.getCell(6, 3 + 32).value).toBe(0);
      const detail = workbook.getWorksheet("Chi tiết đơn nghỉ")!;
      expect([detail.getCell("B4").value, detail.getCell("K4").value, detail.getCell("L4").value]).toEqual(["Nhân viên B", "Đã duyệt", "Quản trị A"]);
      expect([detail.getCell("G5").value, detail.getCell("J5").value, detail.getCell("K5").value]).toEqual(["Buổi sáng", "(không ghi lý do)", "Chờ duyệt"]);
    }
  });
});

describe("decide (PD-057 / PD-065: the leave_approval feature, by default Quản trị)", () => {
  it("Leaders, Staff and the Director get 403 before any request is read; non-members 404", async () => {
    for (const roles of [["LEADER"], ["STAFF"], ["DIRECTOR"], ["LEADER", "ACCOUNT"]]) {
      expect(await failure(decideLeaveRequest(contextWith(roles), leaveId, { decision: "APPROVED" }))).toEqual({
        code: "FORBIDDEN",
        status: 403,
        message: "Bạn không có quyền duyệt đơn nghỉ."
      });
    }
    expect(readSettingsOnly()).toBe(true);
    db.state.calls = [];
    expect(await failure(decideLeaveRequest(contextWith([]), leaveId, { decision: "REJECTED" }))).toMatchObject({ status: 404 });
    expect(db.state.calls).toHaveLength(0);
    expect(spies.events).toHaveLength(0);
  });

  it("the superadmin moves leave_approval to Leader: Leaders decide and export, a production Admin no longer (the superadmin always)", async () => {
    let status = "PENDING";
    const stored = approvers(["LEADER"]);
    db.state.handler = (call) => {
      const settings = stored(call);
      if (settings) return settings;
      if (call.text.startsWith("SELECT status FROM production.leave_requests")) return [{ status }];
      if (call.text.startsWith("UPDATE production.leave_requests")) {
        status = String(call.values[0]);
        return [];
      }
      if (call.text.includes("FROM production.leave_requests lr")) return [leaveRow({ status })];
      return undefined;
    };
    expect(await decideLeaveRequest(contextWith(["LEADER"]), leaveId, { decision: "APPROVED" })).toMatchObject({ status: "APPROVED", canDecide: false });
    status = "PENDING";
    expect((await listPendingLeave(contextWith(["LEADER"]))).items[0]).toMatchObject({ canDecide: true });
    expect((await listPendingLeave(contextWith(["ADMIN"]))).items[0]).toMatchObject({ canDecide: false });
    expect(await failure(decideLeaveRequest(contextWith(["ADMIN"]), leaveId, { decision: "APPROVED" }))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await failure(exportLeaveAttendance(contextWith(["ADMIN"]), fakeResponse().res, { from: "2026-10-01", to: "2026-10-31" }))).toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
    expect((await listPendingLeave(contextWith([], { superadmin: true }))).items[0]).toMatchObject({ canDecide: true });
  });

  it("a Director given leave_approval sees every pending request with its details and decides it", async () => {
    const stored = approvers(["ADMIN", "DIRECTOR"]);
    db.state.handler = (call) => stored(call) ?? (call.text.includes("FROM production.leave_requests lr") ? [leaveRow()] : undefined);
    const pending = await listPendingLeave(contextWith(["DIRECTOR"]));
    expect(pending.items[0]).toMatchObject({ canDecide: true, note: "Việc gia đình" });
    const calendar = await getLeaveCalendar(contextWith(["DIRECTOR"]), { from: "2026-10-01", to: "2026-10-31" });
    const window = db.state.calls.find((call) => call.text.includes("FROM production.leave_requests lr") && call.text.includes("lr.slot_range"))!;
    expect(window.values).toContain(true);
    expect(calendar.items[0]).toMatchObject({ canDecide: true });
    // Without the feature the Director has no pending queue at all (not a Leader either).
    clearProductionConfigCache();
    db.state.handler = (call) => (call.text.includes("FROM production.leave_requests lr") ? [leaveRow()] : undefined);
    expect(await failure(listPendingLeave(contextWith(["DIRECTOR"])))).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("ADMIN and the superadmin decide — their own requests too — and notify the requester", async () => {
    let status = "PENDING";
    db.state.handler = (call) => {
      if (call.text.startsWith("SELECT status FROM production.leave_requests")) {
        return [{ status }];
      }
      if (call.text.startsWith("UPDATE production.leave_requests")) {
        status = String(call.values[0]);
        return [];
      }
      if (call.text.includes("FROM production.leave_requests lr")) {
        return [leaveRow({ user_id: me, owner: user(me, "Quản trị A"), status, decided_at: new Date(), decider: user(me, "Quản trị A") })];
      }
      return undefined;
    };
    const decided = await decideLeaveRequest(contextWith(["ADMIN"]), leaveId, { decision: "APPROVED", note: "OK" });
    expect(decided).toMatchObject({ status: "APPROVED", canDecide: false });
    expect(spies.events.map((event) => event.type)).toEqual(["production.leave.decided"]);

    status = "PENDING";
    expect(await decideLeaveRequest(contextWith([], { superadmin: true }), leaveId, { decision: "REJECTED" })).toMatchObject({ status: "REJECTED" });

    // Already decided → 409.
    expect(await failure(decideLeaveRequest(contextWith(["ADMIN"]), leaveId, { decision: "APPROVED" }))).toMatchObject({ code: "LEAVE_NOT_PENDING", status: 409 });
  });

  it("Leaders still see pending requests (queue and calendar) but cannot decide them; ADMIN can", async () => {
    db.state.handler = (call) => (call.text.includes("FROM production.leave_requests lr") ? [leaveRow()] : undefined);
    const forLeader = await listPendingLeave(contextWith(["LEADER"]));
    expect(forLeader.items).toHaveLength(1);
    expect(forLeader.items[0]).toMatchObject({ status: "PENDING", canDecide: false, note: "Việc gia đình" });
    expect((await listPendingLeave(contextWith(["ADMIN"]))).items[0]!.canDecide).toBe(true);
    expect(await failure(listPendingLeave(contextWith(["STAFF"])))).toMatchObject({ code: "FORBIDDEN", status: 403 });

    const calendar = await getLeaveCalendar(contextWith(["LEADER"]), { from: "2026-10-01", to: "2026-10-31" });
    expect(calendar.items[0]).toMatchObject({ status: "PENDING", canDecide: false });
    // The calendar accepts a one-year window ("Khoảng ngày").
    await getLeaveCalendar(contextWith(["STAFF"]), { from: "2026-01-01", to: "2026-12-31" });
    expect(await failure(getLeaveCalendar(contextWith(["STAFF"]), { from: "2026-01-01", to: "2027-01-02" }))).toMatchObject({
      code: "LEAVE_WINDOW_TOO_LONG",
      message: "Chỉ xem được tối đa 366 ngày mỗi lần."
    });
  });
});

describe("new request reason (PD-065: optional again)", () => {
  const base = { fromDate: "2026-10-20", toDate: "2026-10-20" };

  it("is optional: missing, null or blank → null; otherwise trimmed (any length up to the maximum)", () => {
    for (const note of [undefined, null, "", "   "]) {
      expect(CreateLeaveRequestSchema.parse({ ...base, ...(note === undefined ? {} : { note }) })).toEqual({ ...base, part: "FULL_DAY", note: null });
    }
    expect(CreateLeaveRequestSchema.parse({ ...base, note: "  ab  " }).note).toBe("ab");
    expect(CreateLeaveRequestSchema.parse({ ...base, note: "  Ốm sốt  " }).note).toBe("Ốm sốt");
    expect(CreateLeaveRequestSchema.parse({ ...base, part: "MORNING", note: "Khám bệnh" })).toEqual({ ...base, part: "MORNING", note: "Khám bệnh" });
  });

  it("a request without a reason is stored with note NULL and notifies the approvers", async () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    db.state.handler = (call) =>
      call.text.startsWith("INSERT INTO production.leave_requests") ? [{ id: leaveId }]
      : call.text.includes("FROM production.leave_requests lr") ? [leaveRow({ user_id: me, owner: user(me, "Quản trị A"), note: null })]
      : undefined;
    const created = await createLeaveRequest(contextWith(["STAFF"]), CreateLeaveRequestSchema.parse({ fromDate: soon, toDate: soon }));
    expect(created).toMatchObject({ status: "PENDING", note: null });
    const insert = db.state.calls.find((call) => call.text.startsWith("INSERT INTO production.leave_requests"))!;
    expect(insert.values.at(-1)).toBeNull();
    expect(spies.events.map((event) => event.type)).toEqual(["production.leave.requested"]);
  });

  it("is at most 1000 characters and never contains NUL", () => {
    expect(CreateLeaveRequestSchema.safeParse({ ...base, note: "a".repeat(1000) }).success).toBe(true);
    expect(CreateLeaveRequestSchema.safeParse({ ...base, note: "a".repeat(1001) }).success).toBe(false);
    expect(CreateLeaveRequestSchema.safeParse({ ...base, note: "abc\u0000" }).success).toBe(false);
  });
});
