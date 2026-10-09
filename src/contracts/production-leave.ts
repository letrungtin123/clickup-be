import { z } from "zod";

import { UserRefSchema } from "./work.js";

/**
 * Production (Photo Retouch) shared leave calendar ("Lịch nghỉ") — docs/retouch/SPEC.md §6.3,
 * PLAN §10. Shared FE/BE. Dates are inclusive business calendar days (Asia/Ho_Chi_Minh).
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
  /** A request may start at most this many days before today. */
  maxPastDays: 30,
  /** A request may start at most this many days after today. */
  maxFutureDays: 366,
  /** Inclusive length of one request, in days. */
  maxRequestDays: 31,
  /** Inclusive length of one calendar query window, in days. */
  maxCalendarDays: 93,
  noteMaxLength: 1000
} as const;

/**
 * One leave request as the caller may see it. `note`, `decisionNote`, `decidedBy` and the owner's
 * email are null unless the caller owns the request or is LEADER/ADMIN.
 */
export const LeaveRequestSchema = z.object({
  id: Id,
  user: UserRefSchema,
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
  /** The caller may cancel it now (owner before it starts, ADMIN anytime). */
  canCancel: z.boolean(),
  /** The caller may approve/reject it now (LEADER/ADMIN; LEADER not on own requests). */
  canDecide: z.boolean()
});
export type LeaveRequest = z.infer<typeof LeaveRequestSchema>;

export const LeaveRequestCollectionSchema = z.object({ items: z.array(LeaveRequestSchema) });
export type LeaveRequestCollection = z.infer<typeof LeaveRequestCollectionSchema>;

/** GET /production/leave?from&to — inclusive window, at most leaveLimits.maxCalendarDays days. */
export const LeaveCalendarQuerySchema = z.object({ from: DateOnly, to: DateOnly });

/**
 * Everyone: APPROVED requests of all members + own requests in any status.
 * LEADER/ADMIN: also every PENDING request.
 */
export const LeaveCalendarSchema = z.object({
  from: DateOnly,
  to: DateOnly,
  /** Business "today" (Asia/Ho_Chi_Minh). */
  today: DateOnly,
  items: z.array(LeaveRequestSchema)
});
export type LeaveCalendar = z.infer<typeof LeaveCalendarSchema>;

/** POST /production/leave — always for the signed-in user. */
export const CreateLeaveRequestSchema = z
  .object({
    fromDate: DateOnly,
    toDate: DateOnly,
    part: LeavePartSchema.default("FULL_DAY"),
    note: z.string().trim().max(leaveLimits.noteMaxLength).nullable().optional()
  })
  .strict();
export type CreateLeaveRequest = z.infer<typeof CreateLeaveRequestSchema>;

/** POST /production/leave/:id/decide — LEADER/ADMIN. */
export const DecideLeaveRequestSchema = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED"]),
    note: z.string().trim().max(leaveLimits.noteMaxLength).nullable().optional()
  })
  .strict();
export type DecideLeaveRequest = z.infer<typeof DecideLeaveRequestSchema>;
