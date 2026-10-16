import { z } from "zod";

import { hasNoNul, SafeText } from "./production-catalog.js";
import { UserRefSchema } from "./work.js";

/**
 * Production (Photo Retouch) shared leave calendar ("Lịch nghỉ") — docs/retouch/SPEC.md §6.3,
 * PLAN §10, PD-057. Shared FE/BE. Dates are inclusive business calendar days (Asia/Ho_Chi_Minh).
 */

const Id = z.string().uuid();
const IsoDate = z.string().datetime({ offset: true });
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải có dạng YYYY-MM-DD.");

/** FULL_DAY covers every day of [fromDate, toDate]; MORNING/AFTERNOON only for a single day (0.5 day). */
export const leaveParts = ["FULL_DAY", "MORNING", "AFTERNOON"] as const;
export const LeavePartSchema = z.enum(leaveParts);
export type LeavePart = z.infer<typeof LeavePartSchema>;

export const leaveStatuses = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export const LeaveStatusSchema = z.enum(leaveStatuses);
export type LeaveStatus = z.infer<typeof LeaveStatusSchema>;

/** Server-enforced limits (also useful for FE form hints). */
export const leaveLimits = {
  /** A request may start at most this many days before today — 0: never in the past (PD-051). */
  maxPastDays: 0,
  /** A request may start at most this many days after today. */
  maxFutureDays: 366,
  /** Inclusive length of one request, in days. */
  maxRequestDays: 31,
  /** Inclusive length of one calendar query / export window, in days (PD-057: one year, for "Khoảng ngày"). */
  maxCalendarDays: 366,
  /** A new request's reason ("Lý do nghỉ", PD-057) is required: trimmed, at least this many characters. */
  noteMinLength: 3,
  noteMaxLength: 1000
} as const;

/** PD-057: the reason is required on new requests (older rows may have none; they export as "(không ghi lý do)"). */
export const leaveNoteRequiredMessage = "Nhập lý do nghỉ (ít nhất 3 ký tự).";

/**
 * One leave request as the caller may see it. `note`, `decisionNote`, `decidedBy` and the owner's
 * email are null unless the caller owns the request or is LEADER/ADMIN (Leaders keep seeing the
 * details read-only: only ADMIN decides, PD-057).
 */
export const LeaveRequestSchema = z.object({
  id: Id,
  user: UserRefSchema,
  /** The requester's report team (label only), for the calendar's team filter. */
  team: z.object({ id: Id, name: z.string() }).nullable(),
  fromDate: DateOnly,
  toDate: DateOnly,
  part: LeavePartSchema,
  /** Calendar days covered (half day = 0.5). */
  days: z.number(),
  note: z.string().nullable(),
  status: LeaveStatusSchema,
  decidedBy: UserRefSchema.nullable(),
  decidedAt: IsoDate.nullable(),
  decisionNote: z.string().nullable(),
  cancelledAt: IsoDate.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  /** The caller may cancel it now: owner or ADMIN, only before it starts (PD-059). */
  canCancel: z.boolean(),
  /** The caller may approve/reject it now: ADMIN (organization superadmins included), PENDING only (PD-057). */
  canDecide: z.boolean()
});
export type LeaveRequest = z.infer<typeof LeaveRequestSchema>;

export const LeaveRequestCollectionSchema = z.object({ items: z.array(LeaveRequestSchema) });
export type LeaveRequestCollection = z.infer<typeof LeaveRequestCollectionSchema>;

/** GET /production/leave?from&to — inclusive window, at most leaveLimits.maxCalendarDays days. */
export const LeaveCalendarQuerySchema = z.object({ from: DateOnly, to: DateOnly, teamId: Id.optional() });

/**
 * Everyone: APPROVED requests of all members + own requests in any status.
 * LEADER/ADMIN: also every PENDING request (Leaders read-only — `canDecide` is ADMIN only, PD-057).
 */
export const LeaveCalendarSchema = z.object({
  from: DateOnly,
  to: DateOnly,
  /** Business "today" (Asia/Ho_Chi_Minh). */
  today: DateOnly,
  items: z.array(LeaveRequestSchema)
});
export type LeaveCalendar = z.infer<typeof LeaveCalendarSchema>;

/**
 * GET /production/leave/export?from&to[&teamId] — ADMIN only (PD-057; organization superadmins included): the
 * payroll attendance workbook ("Bảng chấm công nghỉ phép") of the inclusive window, at most
 * leaveLimits.maxCalendarDays days. Response: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet with
 * `Content-Disposition: attachment; filename="cham-cong-nghi-phep_<from>_<to>.xlsx"` (+ RFC 5987 filename*).
 * Errors are JSON: 404 not a production member / unknown team, 403 FORBIDDEN not ADMIN, 400 invalid window.
 * Sheet "Chấm công": every active production member (team filter: that report team) × every day, APPROVED requests
 * only — P = nghỉ cả ngày, S = buổi sáng, C = buổi chiều, S+C = cả hai buổi (1 ngày). Sheet "Chi tiết đơn nghỉ":
 * APPROVED, PENDING and REJECTED requests overlapping the window (never CANCELLED).
 */
export const LeaveExportQuerySchema = z.object({ from: DateOnly, to: DateOnly, teamId: Id.optional() });
export type LeaveExportQuery = z.infer<typeof LeaveExportQuerySchema>;

/** POST /production/leave — always for the signed-in user. The reason (`note`) is required (PD-057). */
export const CreateLeaveRequestSchema = z
  .object({
    fromDate: DateOnly,
    toDate: DateOnly,
    part: LeavePartSchema.default("FULL_DAY"),
    note: z
      .string({ error: leaveNoteRequiredMessage })
      .refine(hasNoNul, "Không được chứa ký tự NUL.")
      .trim()
      .min(leaveLimits.noteMinLength, leaveNoteRequiredMessage)
      .max(leaveLimits.noteMaxLength, `Lý do nghỉ tối đa ${leaveLimits.noteMaxLength} ký tự.`)
  })
  .strict();
export type CreateLeaveRequest = z.infer<typeof CreateLeaveRequestSchema>;

/** POST /production/leave/:id/decide — ADMIN only (PD-057: 403 "Chỉ Quản trị mới duyệt được đơn nghỉ."). */
export const DecideLeaveRequestSchema = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED"]),
    note: SafeText().trim().max(leaveLimits.noteMaxLength).nullable().optional()
  })
  .strict();
export type DecideLeaveRequest = z.infer<typeof DecideLeaveRequestSchema>;
