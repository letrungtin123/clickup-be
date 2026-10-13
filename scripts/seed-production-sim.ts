/**
 * LOCAL DEVELOPMENT ONLY — "a retouch department running since May 2026". Simulates June 1 → today on top
 * of the May worklog replay (scripts/seed-from-worklog.ts) through the real production engine: insertTasks /
 * moveTasks / scoring hooks / settleJob with historical times, KPI targets and settlement runs, leave,
 * saved reports, anomaly reviews, job chats and a realistic inbox for the last days.
 *
 *   cd BE && npx tsx scripts/seed-from-worklog.ts            # the May worklog first (once)
 *   cd BE && npx tsx scripts/seed-production-sim.ts [--seed 20261010] [--dry-run] [--reset]
 *
 *   --seed N    deterministic plan (default 20261010); the "now" cut-off is the real clock
 *   --dry-run   plan only and print the statistics — nothing is written
 *   --reset     remove what this script created (manifest: production.settings 'seed_sim_manifest') and stop
 *   --owner-email E  (or SEED_SIM_OWNER_EMAIL) the owner's login that gets an inbox, saved reports, chat
 *               mentions …; default: the organization member whose org role is "superadmin"
 *
 * Idempotent: every run first removes what the previous run created, then rebuilds. Kept on --reset: the
 * accounts it created (lead02, acc02), display names, roles, team names and production settings.
 * Only invented people, brands and texts; the catalog (projects, processes, credit rules, shifts, statuses)
 * is read from the database at run time. New account passwords go to BE/.env.seed-worklog (git-ignored)
 * and are never printed. Run it again after seed-from-worklog.ts (which re-grants QC to its checkers).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import "dotenv/config";

import { SendMessageRequestSchema } from "../src/contracts/chat.js";
import {
  UpdateProductionMemberRequestSchema,
  UpdateProductionSettingsRequestSchema,
  UpsertClientRequestSchema,
  UpsertCustomFieldRequestSchema,
  UpsertProductionProjectRequestSchema,
  UpsertTagRequestSchema
} from "../src/contracts/production-catalog.js";
import type { TaskKind } from "../src/contracts/production-jobs.js";
import { CreateSavedReportRequestSchema, type AnomalyKind } from "../src/contracts/production-reports.js";
import { PutKpiTargetsRequestSchema } from "../src/contracts/production-scores.js";
import { closeDatabase, getSql } from "../src/db/client.js";
import { AppError } from "../src/lib/app-error.js";
import type { QuerySql } from "../src/lib/db-types.js";
import { closeRedis } from "../src/lib/redis.js";
import { invalidateAccessContexts, resolveAccessContext, type AccessContext } from "../src/modules/access/access-context.js";
import { sendMessage } from "../src/modules/chat/messages.service.js";
import { listAnomalies, reviewAnomaly } from "../src/modules/production/anomalies.service.js";
import {
  listClients,
  listCustomFields,
  listTags,
  updateMember,
  updateSettings,
  upsertClient,
  upsertCustomField,
  upsertProject,
  upsertTag,
  upsertTeam
} from "../src/modules/production/catalog.service.js";
import { deleteCreditRuleVersion, setCreditRule } from "../src/modules/production/credit-rules.js";
import { loadFieldDefinitions, setEntityTags, validateCustomValues } from "../src/modules/production/custom-fields.js";
import { openJobChat } from "../src/modules/production/job-chat.service.js";
import { loadWorkflowModel, selectTasks, type TaskRow } from "../src/modules/production/jobs.repo.js";
import { settleMonth } from "../src/modules/production/kpi-settlement.service.js";
import { putKpiTargets } from "../src/modules/production/kpi-targets.service.js";
import { approvedLeaveDaysByUser } from "../src/modules/production/leave.service.js";
import { createSavedReport } from "../src/modules/production/saved-reports.service.js";
import { onTaskQtyChanged } from "../src/modules/production/scoring-hooks.js";
import { countWorkingDays, latestClosedPeriod, periodCloseInstant, periodOfDay, periodRange, settleUser, shiftPeriod } from "../src/modules/production/scoring.js";
import { insertTaskLogs, insertTasks, moveTask, moveTasks, settleJob } from "../src/modules/production/tasks.service.js";
import { addDays, businessDay, startOfBusinessDay } from "../src/modules/production/time.js";
import { feedbackTaskDeadline, statusByCode, type SystemStatusCode, type Workflow, type WorkflowStatus } from "../src/modules/production/workflow.js";
import { assertDevDatabase } from "./lib/dev-guard.js";

// Arguments & safety ---------------------------------------------------------------------------------------

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index]!;
  if (key.startsWith("--")) {
    args.set(key.slice(2), process.argv[index + 1] && !process.argv[index + 1]!.startsWith("--") ? process.argv[++index]! : "true");
  }
}
const seedArg = Number(args.get("seed") ?? "20261010") >>> 0 || 20261010;
const dryRun = args.has("dry-run");
const resetOnly = args.has("reset");

const isLoopback = (value: string) => {
  try {
    const host = new URL(value).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  } catch {
    return false;
  }
};
const supabaseUrl = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!isLoopback(supabaseUrl) || !isLoopback(process.env.DATABASE_URL ?? "") || !serviceKey) {
  console.error("Refusing to seed: SUPABASE_URL and DATABASE_URL must point at the local stack.");
  process.exit(1);
}
// NODE_ENV=production or a database without the dev marker: refuse before anything is read or written.
await assertDevDatabase();

// Clock, randomness, calendar --------------------------------------------------------------------------------

const NOW = new Date();
const TODAY = businessDay(NOW);
const SIM_FROM = "2026-06-01";
const MANIFEST_KEY = "seed_sim_manifest";
const DRIVE_PREFIX = "https://drive.example/retouch/";
/** Optional: the owner's login that should see a lived-in production side (default: the organization's superadmin). */
const ownerEmail = (args.get("owner-email") ?? process.env.SEED_SIM_OWNER_EMAIL ?? "").trim().toLowerCase();
/** Inbox window: notifications are written for what happened in the last 5 days. */
const INBOX_FROM = new Date(NOW.getTime() - 5 * 86_400_000);
/** National Day holiday (no work, no jobs). */
const HOLIDAYS = new Set(["2026-09-01", "2026-09-02"]);

const hashText = (text: string) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/** mulberry32 per label: one stream per concern, so tuning one part does not reshuffle the others. */
class Rng {
  private state: number;
  constructor(label: string) {
    this.state = hashText(`${seedArg}:${label}`) || 1;
  }
  next() {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }
  int(min: number, max: number) {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  float(min: number, max: number) {
    return min + this.next() * (max - min);
  }
  chance(probability: number) {
    return this.next() < probability;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    const total = items.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
    let roll = this.next() * total;
    for (const item of items) {
      roll -= Math.max(0, weight(item));
      if (roll < 0) {
        return item;
      }
    }
    return items[items.length - 1]!;
  }
  normal() {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  logNormal(median: number, sigma: number) {
    return median * Math.exp(sigma * this.normal());
  }
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const other = Math.floor(this.next() * (index + 1));
      [copy[index], copy[other]] = [copy[other]!, copy[index]!];
    }
    return copy;
  }
}

const vn = (day: string, time: string) => new Date(`${day}T${time}:00+07:00`);
const plusMinutes = (at: Date, count: number) => new Date(at.getTime() + Math.round(count * 60_000));
const maxDate = (...dates: Date[]) => new Date(Math.max(...dates.map((date) => date.getTime())));
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const isWorkday = (day: string) => weekday(day) !== 0 && !HOLIDAYS.has(day);
const nextWorkday = (day: string) => {
  let next = addDays(day, 1);
  while (!isWorkday(next)) next = addDays(next, 1);
  return next;
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const pad2 = (value: number) => String(value).padStart(2, "0");
const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false });
const hhmm = (at: Date) => timeFormatter.format(at);

type Span = readonly [number, number];
type Profile = "staff" | "leader" | "account" | "ot";
type LeavePart = "FULL_DAY" | "MORNING" | "AFTERNOON";

const profileHours: Record<Profile, [string, string][]> = {
  staff: [
    ["08:00", "12:00"],
    ["13:00", "17:30"]
  ],
  leader: [
    ["08:00", "12:00"],
    ["13:00", "18:00"]
  ],
  account: [
    ["08:00", "12:00"],
    ["13:00", "18:30"]
  ],
  ot: [["18:00", "21:30"]]
};

/** Approved leave (planned) per user and day — people are not scheduled while on leave. */
const leaveDays = new Map<string, Map<string, LeavePart>>();
const windowCache = new Map<string, Span[]>();

const windowsFor =
  (userId: string | null, profile: Profile) =>
  (day: string): Span[] => {
    const cacheKey = `${userId ?? "-"}|${profile}|${day}`;
    const cached = windowCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    let spans: Span[] = [];
    if (isWorkday(day)) {
      const leave = userId ? leaveDays.get(userId)?.get(day) : undefined;
      spans = profileHours[profile]
        .filter((_, index) => {
          if (!leave) {
            return true;
          }
          if (leave === "FULL_DAY") {
            return false;
          }
          if (profile === "ot") {
            return leave === "MORNING";
          }
          return leave === "MORNING" ? index !== 0 : index === 0;
        })
        .map(([from, to]) => [vn(day, from).getTime(), vn(day, to).getTime()] as const);
    }
    windowCache.set(cacheKey, spans);
    return spans;
  };

/** `minutes` of work starting at `start`, counted only inside the person's working windows. */
const advance = (start: Date, minutes: number, windows: (day: string) => Span[]): Date => {
  let cursor = start.getTime();
  let left = Math.max(0, minutes) * 60_000;
  for (let guard = 0; guard < 900; guard += 1) {
    const day = businessDay(new Date(cursor));
    for (const [from, to] of windows(day)) {
      if (to <= cursor) {
        continue;
      }
      const begin = Math.max(cursor, from);
      if (begin + left <= to) {
        return new Date(begin + Math.round(left));
      }
      left -= to - begin;
      cursor = to;
    }
    cursor = startOfBusinessDay(addDays(day, 1)).getTime();
  }
  throw new Error("advance(): no working window found");
};

/** Working minutes inside the given windows between two instants. */
const workingMinutesIn = (from: Date, to: Date, windows: (day: string) => Span[]) => {
  let total = 0;
  for (let day = businessDay(from); day <= businessDay(to); day = addDays(day, 1)) {
    for (const [start, end] of windows(day)) {
      total += Math.max(0, Math.min(end, to.getTime()) - Math.max(start, from.getTime())) / 60_000;
    }
  }
  return total;
};
const workingMinutesBetween = (from: Date, to: Date) => workingMinutesIn(from, to, windowsFor(null, "staff"));

// People -------------------------------------------------------------------------------------------------------

type StaffProfile = {
  name: string;
  speed: number;
  share: number;
  failRate: number;
  level: "junior" | "middle" | "senior";
  joined: string;
  skills: string[];
  khoan?: number;
};

const staffProfiles: Record<string, StaffProfile> = {
  NV01: { name: "Nguyễn Thị Hồng Nhung", speed: 0.9, share: 1.25, failRate: 0.04, level: "senior", joined: "2023-03-06", skills: ["retouch", "model"] },
  NV02: { name: "Trần Minh Quân", speed: 0.95, share: 0.5, failRate: 0.04, level: "senior", joined: "2022-08-15", skills: ["retouch", "color"] },
  NV03: { name: "Lê Thị Thu Hà", speed: 1.15, share: 0.8, failRate: 0.08, level: "junior", joined: "2026-02-16", skills: ["clipping", "ecommerce"] },
  NV04: { name: "Phạm Đức Anh", speed: 1.05, share: 1.0, failRate: 0.06, level: "middle", joined: "2024-05-20", skills: ["retouch", "ecommerce"] },
  NV05: { name: "Hoàng Ngọc Trâm", speed: 1.0, share: 1.05, failRate: 0.05, level: "middle", joined: "2024-09-09", skills: ["model", "retouch"], khoan: 0.3 },
  NV06: { name: "Võ Thành Đạt", speed: 1.0, share: 0.5, failRate: 0.04, level: "senior", joined: "2022-11-01", skills: ["color", "retouch"] },
  NV07: { name: "Đặng Thị Mai Anh", speed: 0.9, share: 1.2, failRate: 0.05, level: "middle", joined: "2023-10-02", skills: ["retouch", "shoes"] },
  NV08: { name: "Bùi Quốc Huy", speed: 1.2, share: 0.85, failRate: 0.17, level: "junior", joined: "2025-12-01", skills: ["clipping"] },
  NV09: { name: "Đỗ Phương Thảo", speed: 0.8, share: 0.6, failRate: 0.03, level: "senior", joined: "2021-06-14", skills: ["model", "retouch", "color"] },
  NV10: { name: "Ngô Gia Bảo", speed: 1.1, share: 0.9, failRate: 0.06, level: "middle", joined: "2024-03-11", skills: ["ecommerce", "clipping"], khoan: 0.2 },
  NV11: { name: "Dương Thị Kim Ngân", speed: 0.95, share: 1.1, failRate: 0.05, level: "middle", joined: "2023-07-17", skills: ["retouch", "model"] },
  NV12: { name: "Lý Hoàng Phúc", speed: 1.15, share: 0.85, failRate: 0.1, level: "junior", joined: "2025-09-08", skills: ["retouch"] },
  NV13: { name: "Huỳnh Thị Yến Vy", speed: 1.0, share: 0.5, failRate: 0.04, level: "senior", joined: "2022-04-04", skills: ["color", "model"] },
  NV14: { name: "Phan Tuấn Kiệt", speed: 0.95, share: 1.15, failRate: 0.05, level: "middle", joined: "2024-01-08", skills: ["shoes", "retouch"] },
  NV15: { name: "Trương Mỹ Linh", speed: 1.0, share: 1.0, failRate: 0.05, level: "middle", joined: "2023-12-04", skills: ["ecommerce", "retouch"] }
};
const staffKeys = Object.keys(staffProfiles);
const qcStaffKeys = new Set(["NV02", "NV06", "NV09", "NV13"]);
/** Team 0 = "Team Ánh Sáng" (LEAD01), team 1 = "Team Sắc Màu" (LEAD02) — the worklog's A/B split. */
const teamOfStaff = (key: string) => ((Number(key.slice(2)) - 1) % 2) as 0 | 1;
const teamNames = ["Team Ánh Sáng", "Team Sắc Màu"] as const;
const legacyTeamNames = ["Seed Team A", "Seed Team B"] as const;

type AccountSpec = { key: string; email: string; name: string; roles: string[]; title: string; team: 0 | 1 | null; created: boolean };
const accountSpecs: AccountSpec[] = [
  ...staffKeys.map((key) => ({
    key,
    email: `${key.toLowerCase()}@test.local`,
    name: staffProfiles[key]!.name,
    roles: qcStaffKeys.has(key) ? ["STAFF", "QC"] : ["STAFF"],
    title: qcStaffKeys.has(key) ? "Retoucher kiêm QC" : staffProfiles[key]!.level === "junior" ? "Retoucher (đang đào tạo)" : "Retoucher",
    team: teamOfStaff(key),
    created: false
  })),
  { key: "LEAD01", email: "lead01@test.local", name: "Vũ Hải Đăng", roles: ["LEADER", "QC"], title: "Leader Team Ánh Sáng", team: 0, created: false },
  { key: "LEAD02", email: "lead02@test.local", name: "Mai Thanh Tùng", roles: ["LEADER", "QC"], title: "Leader Team Sắc Màu", team: 1, created: true },
  { key: "ACC01", email: "acc01@test.local", name: "Nguyễn Hoàng Yến", roles: ["ACCOUNT"], title: "Account – chăm sóc khách hàng", team: null, created: false },
  { key: "ACC02", email: "acc02@test.local", name: "Lâm Bảo Ngọc", roles: ["ACCOUNT"], title: "Account – chăm sóc khách hàng", team: null, created: true },
  { key: "ADMIN01", email: "admin01@test.local", name: "Trần Quốc Thắng", roles: ["ADMIN"], title: "Quản lý sản xuất", team: null, created: false }
];

type Person = { key: string; id: string; name: string; team: 0 | 1 | null; isQc: boolean; isLeader: boolean; profile?: StaffProfile };

// Fake catalog extras ---------------------------------------------------------------------------------------

type FieldSpec = {
  entity: "JOB" | "TASK" | "USER" | "CLIENT";
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "SELECT" | "MULTISELECT";
  options?: { value: string; label: string; color?: string }[];
  showInTable?: boolean;
};
const fieldSpecs: FieldSpec[] = [
  {
    entity: "CLIENT",
    key: "kenh_nhan_anh",
    label: "Kênh nhận ảnh",
    type: "SELECT",
    showInTable: true,
    options: [
      { value: "gdrive", label: "Google Drive", color: "green" },
      { value: "dropbox", label: "Dropbox", color: "blue" },
      { value: "wetransfer", label: "WeTransfer", color: "sky" },
      { value: "ftp", label: "FTP riêng", color: "slate" },
      { value: "onedrive", label: "OneDrive", color: "indigo" }
    ]
  },
  {
    entity: "CLIENT",
    key: "dinh_dang_xuat",
    label: "Định dạng xuất mặc định",
    type: "SELECT",
    showInTable: true,
    options: [
      { value: "jpg_srgb", label: "JPG sRGB 2000px" },
      { value: "png_trong", label: "PNG nền trong" },
      { value: "tiff16", label: "TIFF 16-bit" },
      { value: "psd_layer", label: "PSD giữ layer" },
      { value: "webp", label: "WebP cho web" }
    ]
  },
  {
    entity: "CLIENT",
    key: "muc_uu_tien",
    label: "Mức ưu tiên",
    type: "SELECT",
    showInTable: true,
    options: [
      { value: "thuong", label: "Thường", color: "slate" },
      { value: "cao", label: "Cao", color: "amber" },
      { value: "vip", label: "VIP", color: "red" }
    ]
  },
  { entity: "CLIENT", key: "nguoi_lien_he", label: "Người liên hệ", type: "TEXT" },
  { entity: "CLIENT", key: "sla_gio", label: "SLA (giờ)", type: "NUMBER" },
  {
    entity: "JOB",
    key: "dinh_dang_xuat",
    label: "Định dạng xuất",
    type: "SELECT",
    showInTable: true,
    options: [
      { value: "jpg_srgb", label: "JPG sRGB 2000px" },
      { value: "png_trong", label: "PNG nền trong" },
      { value: "tiff16", label: "TIFF 16-bit" },
      { value: "psd_layer", label: "PSD giữ layer" },
      { value: "webp", label: "WebP cho web" }
    ]
  },
  {
    entity: "JOB",
    key: "uu_tien",
    label: "Ưu tiên",
    type: "SELECT",
    showInTable: true,
    options: [
      { value: "thuong", label: "Thường", color: "slate" },
      { value: "gap", label: "Gấp", color: "orange" },
      { value: "rat_gap", label: "Rất gấp", color: "red" }
    ]
  },
  { entity: "JOB", key: "ma_po", label: "Mã PO khách", type: "TEXT" },
  { entity: "JOB", key: "ngay_chup", label: "Ngày chụp", type: "DATE" },
  { entity: "JOB", key: "ghi_chu_khach", label: "Ghi chú khách", type: "TEXT" },
  {
    entity: "TASK",
    key: "do_kho",
    label: "Độ khó",
    type: "SELECT",
    showInTable: true,
    options: [
      { value: "de", label: "Dễ", color: "green" },
      { value: "tb", label: "Trung bình", color: "amber" },
      { value: "kho", label: "Khó", color: "red" }
    ]
  },
  { entity: "TASK", key: "ghi_chu_ky_thuat", label: "Ghi chú kỹ thuật", type: "TEXT" },
  { entity: "USER", key: "ngay_vao_lam", label: "Ngày vào làm", type: "DATE" },
  {
    entity: "USER",
    key: "cap_bac",
    label: "Cấp bậc",
    type: "SELECT",
    showInTable: true,
    options: [
      { value: "junior", label: "Junior", color: "sky" },
      { value: "middle", label: "Middle", color: "indigo" },
      { value: "senior", label: "Senior", color: "violet" },
      { value: "lead", label: "Leader", color: "fuchsia" }
    ]
  },
  {
    entity: "USER",
    key: "chuyen_mon",
    label: "Chuyên môn",
    type: "MULTISELECT",
    options: [
      { value: "retouch", label: "Retouch sản phẩm" },
      { value: "model", label: "Retouch model" },
      { value: "clipping", label: "Tách nền" },
      { value: "color", label: "Chỉnh màu" },
      { value: "shoes", label: "Giày dép – phụ kiện" },
      { value: "ecommerce", label: "Ảnh e-commerce" }
    ]
  },
  // PLAN §10: "Năng lực" (A++, A, B) as a SELECT on User, shown in the table and filterable in the reports.
  {
    entity: "USER",
    key: "nang_luc",
    label: "Năng lực",
    type: "SELECT",
    showInTable: true,
    options: [
      { value: "a_plus_plus", label: "A++", color: "violet" },
      { value: "a", label: "A", color: "blue" },
      { value: "b", label: "B", color: "slate" }
    ]
  },
  // SPEC §9 P1.3: the "Mã đơn hàng" field on Job, in the form and the table.
  { entity: "JOB", key: "ma_don_hang", label: "Mã đơn hàng", type: "TEXT", showInTable: true }
];

/** "Năng lực" of a person: from the level (senior A++, middle A, junior B), a few nudged by a stable hash. */
const competenceOf = (key: string, level: "junior" | "middle" | "senior" | "lead") => {
  const nudge = hashText(`nang_luc:${key}`) % 5 === 0;
  if (level === "lead" || level === "senior") {
    return nudge && level === "senior" ? "a" : "a_plus_plus";
  }
  return level === "middle" ? (nudge ? "a_plus_plus" : "a") : nudge ? "a" : "b";
};
/** "Mã đơn hàng" of a recent job (last 45 days), derived from its code — no draw from the plan's random streams. */
const orderNumberOf = (code: string, day: string) => `ĐH${day.slice(2, 4)}${day.slice(5, 7)}-${String(1000 + (hashText(`dh:${code}`) % 9000))}`;

const tagSpecs: { name: string; color: string }[] = [
  { name: "VIP", color: "red" },
  { name: "Gấp", color: "orange" },
  { name: "Mẫu mới", color: "violet" },
  { name: "Cần kiểm kỹ", color: "amber" },
  { name: "Khách khó tính", color: "pink" },
  { name: "Lookbook", color: "sky" },
  { name: "Sale campaign", color: "green" },
  { name: "Ảnh model", color: "indigo" },
  { name: "Đang đào tạo", color: "teal" },
  { name: "Kiêm QC", color: "cyan" }
];

type ClientSpec = {
  name: string;
  note: string;
  channel: string;
  format: string;
  priority: string;
  contact: string;
  sla: number;
  tags: string[];
  brand: string;
  requirement: string;
};
const clientSpecs: ClientSpec[] = [
  {
    name: "Lumière Atelier",
    brand: "Lumière",
    requirement: "giữ texture vải, không làm mịn da quá tay",
    note: "Thời trang nữ cao cấp, ảnh lookbook và e-commerce. Giữ texture vải, không làm mịn da quá tay.",
    channel: "gdrive",
    format: "jpg_srgb",
    priority: "vip",
    contact: "Ms. Claire Dubois",
    sla: 24,
    tags: ["VIP", "Khách khó tính"]
  },
  {
    name: "Mộc Lan Fashion",
    brand: "Mộc Lan",
    requirement: "màu phải khớp swatch gửi kèm",
    note: "Áo dài và đồ truyền thống cách tân. Màu phải khớp swatch gửi kèm.",
    channel: "dropbox",
    format: "png_trong",
    priority: "cao",
    contact: "Chị Mai Phương",
    sla: 36,
    tags: ["Lookbook"]
  },
  {
    name: "Northwind Apparel",
    brand: "Northwind",
    requirement: "ghost mannequin sạch, nền trắng tuyệt đối",
    note: "Đồ outdoor xuất khẩu, ảnh flatlay và ghost mannequin số lượng lớn.",
    channel: "wetransfer",
    format: "tiff16",
    priority: "thuong",
    contact: "Mr. Daniel Reyes",
    sla: 48,
    tags: []
  },
  {
    name: "Saigon Denim Co.",
    brand: "Saigon Denim",
    requirement: "giữ màu wash của denim, không là phẳng nếp gấp tự nhiên",
    note: "Denim nam nữ, chạy campaign theo các ngày sale lớn trên sàn.",
    channel: "ftp",
    format: "jpg_srgb",
    priority: "thuong",
    contact: "Anh Quốc Bảo",
    sla: 48,
    tags: ["Sale campaign"]
  },
  {
    name: "Kira Kids",
    brand: "Kira Kids",
    requirement: "nền pastel đúng bảng màu thương hiệu",
    note: "Thời trang trẻ em; nền pastel theo bảng màu thương hiệu.",
    channel: "gdrive",
    format: "jpg_srgb",
    priority: "cao",
    contact: "Chị Thu Trang",
    sla: 24,
    tags: []
  },
  {
    name: "Vela Shoes & Bags",
    brand: "Vela",
    requirement: "bóng đổ tự nhiên, không mất đường chỉ",
    note: "Giày và túi xách; cần bóng đổ tự nhiên, không mất đường chỉ.",
    channel: "onedrive",
    format: "png_trong",
    priority: "thuong",
    contact: "Ms. Hana Sato",
    sla: 48,
    tags: []
  },
  {
    name: "Hạ Vy Boutique",
    brand: "Hạ Vy",
    requirement: "xử lý kỹ ren và đá đính, khách duyệt từng ảnh",
    note: "Boutique váy dạ hội; khách duyệt từng ảnh, hay yêu cầu chỉnh thêm.",
    channel: "gdrive",
    format: "psd_layer",
    priority: "vip",
    contact: "Chị Hạ Vy",
    sla: 24,
    tags: ["VIP"]
  },
  {
    name: "Urban Thread",
    brand: "Urban Thread",
    requirement: "giữ chất ảnh ngoài trời, chỉ chỉnh màu nhẹ",
    note: "Streetwear, ảnh model ngoài trời; mới hợp tác từ tháng 6.",
    channel: "dropbox",
    format: "webp",
    priority: "thuong",
    contact: "Mr. Leo Martins",
    sla: 72,
    tags: ["Mẫu mới"]
  }
];

// Text pools ----------------------------------------------------------------------------------------------

const qcFailNotes = [
  "Còn sót bụi và xơ vải ở cổ áo, xử lý lại giúp nhé.",
  "Màu áo lệch so với ảnh swatch, chỉnh lại theo mẫu.",
  "Viền tách nền bị răng cưa ở phần tóc.",
  "Thiếu bóng đổ nhẹ theo guideline của khách.",
  "Crop sai tỉ lệ 4:5, lề trên bị hẹp.",
  "Nếp nhăn vải ở tay áo chưa xử lý.",
  "Da mẫu bị làm mịn quá, mất texture.",
  "Logo thương hiệu bị mờ sau khi chỉnh.",
  "Nền chưa đạt trắng tuyệt đối ở góc dưới.",
  "Đường may bị mất chi tiết sau khi làm sạch."
];
const qcFailAgainNotes = [
  "Vẫn còn lỗi viền ở mấy ảnh cuối, kiểm tra kỹ trước khi Done nhé.",
  "Màu vẫn chưa khớp swatch, so lại với file REF giúp mình.",
  "Đã sửa nhưng còn 2 ảnh sót bụi, xem lại giúp."
];
const feedbackWrongNotes = [
  "Khách báo màu áo bị lệch so với mẫu thật (xanh navy thành xanh dương).",
  "Một số ảnh bị cắt mất phần đế giày.",
  "Da mẫu bị làm mịn quá, mất texture — khách yêu cầu làm lại.",
  "Khách phát hiện còn sót logo của studio chụp ở góc ảnh.",
  "Nền chưa trắng đều, khách bị sàn từ chối duyệt ảnh."
];
const feedbackExtraNotes = [
  "Khách yêu cầu thêm bản crop 1:1 cho Instagram.",
  "Bổ sung xoá nhãn mác trên các ảnh mặt sau.",
  "Làm thêm bản nền xám nhạt cho bộ lookbook.",
  "Khách muốn thêm bóng đổ phản chiếu cho ảnh giày.",
  "Thêm phiên bản không có mẫu (ghost mannequin) cho 10 ảnh."
];
const feedbackCloseNotes = [
  "Khách xác nhận dùng bản đã giao, không cần sửa.",
  "Đã giải thích với khách: lỗi do file gốc thiếu sáng, khách đồng ý giữ nguyên.",
  "Khách tự chỉnh phía họ, đóng feedback."
];
const qtyLessNotes = ["Khách rút {n} ảnh trùng mã SKU.", "Đếm lại: {n} ảnh lỗi file không xử lý được.", "Khách huỷ {n} ảnh mẫu cũ."];
const qtyMoreNotes = ["Bổ sung {n} ảnh khách gửi thêm qua Drive.", "Khách gửi thêm {n} ảnh góc nghiêng."];
const taskNotes = [
  "Ưu tiên làm 20 ảnh đầu để gửi duyệt mẫu trước 11h.",
  "Theo guideline trong thư mục /guide của khách.",
  "Giữ nguyên màu vải, chỉ làm sạch nền.",
  "Ảnh mẫu tham khảo: file REF_01.jpg trong thư mục gốc.",
  "Xuất JPG 2000px, nền trắng."
];
const techNotes = ["Dùng action AR-Clean v3", "Chú ý viền tóc bay", "Giữ bóng đổ gốc", "Không đổi màu chỉ may"];
const customerNotes = [
  "Giữ nguyên màu vải theo ảnh swatch.",
  "Nền trắng tuyệt đối, bóng đổ nhẹ.",
  "Crop 4:5, chừa lề 5%.",
  "Không làm mịn da quá tay.",
  "Xuất 2 bản: web 2000px và in 5000px."
];
const leaveReasons = [
  "Việc gia đình",
  "Đi khám bệnh",
  "Về quê dự đám cưới",
  "Nghỉ phép năm",
  "Con ốm, xin nghỉ chăm con",
  "Làm giấy tờ cá nhân",
  "Đưa bố mẹ đi khám",
  "Sửa nhà"
];
const rejectNotes = ["Trùng đợt cao điểm cuối tháng, em sắp xếp ngày khác nhé.", "Team đã có 2 bạn nghỉ hôm đó, dời sang tuần sau giúp anh.", "Đang chạy campaign 9.9, chưa duyệt được."];
const reviewNotes: Record<AnomalyKind, string[]> = {
  QTY_MISMATCH: ["Khách rút bớt ảnh, số lượng đúng thực tế.", "Đã đối chiếu với account, OK.", "NV nhập nhầm, đã nhắc lần sau kiểm tra kỹ."],
  QC_FAIL_REPEAT: ["Đã kèm lại NV về chuẩn viền tóc.", "Khách đổi yêu cầu giữa chừng, không phải lỗi NV."],
  WORKER_FAIL_RATE: ["Đang kèm thêm, theo dõi tiếp tháng sau."],
  FAST_DONE: ["NV làm trước offline từ hôm qua, đã xác nhận.", "Task nhỏ, đã kiểm tra file thực tế."],
  MISSING_CREDIT_RULE: ["Đang chờ chốt đơn giá với khách."]
};

const collectionsByMonth: Record<string, string[]> = {
  "06": ["Linen Summer", "Resort 2026", "Back to School", "Summer Sale 6.6"],
  "07": ["Back to School", "Mid-year Sale 7.7", "Basic Tee", "Summer Denim"],
  "08": ["Back to School", "Thu Đông 2026", "8.8 Sale", "Office Wear"],
  "09": ["Thu Đông 2026", "9.9 Sale", "Trung Thu", "Denim Essentials"],
  "10": ["10.10 Sale", "Holiday Edit", "Áo dài Tết 2027", "Thu Đông 2026"],
  "11": ["11.11 Sale", "Black Friday", "Holiday Edit"],
  "12": ["Holiday Edit", "Áo dài Tết 2027"]
};
const jobNameTemplates: ((collection: string, part: number) => string)[] = [
  (collection: string, part: number) => `Ảnh e-commerce ${collection} – đợt ${part}`,
  (collection: string) => `Lookbook ${collection}`,
  (collection: string) => `Bộ ảnh model ${collection}`,
  (collection: string) => `Ảnh mannequin BST ${collection}`,
  () => "Ảnh sản phẩm hàng mới về",
  () => "Ảnh flatlay phụ kiện",
  (collection: string) => `Chiến dịch ${collection}`,
  () => "Cập nhật ảnh website theo SKU",
  () => "Chỉnh màu theo mẫu vải thật"
];

// Catalog --------------------------------------------------------------------------------------------------

type RuleRow = { id: string; projectId: string; processId: string; credit: number; money: number | null; from: string; to: string | null };
type ProjectRow = { id: string; code: string; name: string; active: boolean; qcBuffer: number };
type Catalog = {
  organizationId: string;
  workflow: Workflow;
  projects: ProjectRow[];
  processes: Map<string, { id: string; name: string; isQc: boolean }>;
  qcProcessId: string;
  shifts: { official: string; ot: string; khoan: string };
  rules: RuleRow[];
};

const loadCatalog = async (sql: QuerySql, organizationId: string): Promise<Catalog> => {
  const [projects, processes, shifts, rules, workflow] = await Promise.all([
    sql<ProjectRow[]>`
      SELECT id, code, name, active, qc_buffer_hours AS "qcBuffer" FROM production.projects WHERE organization_id = ${organizationId} ORDER BY upper(code)
    `,
    sql<{ id: string; name: string; is_qc: boolean; active: boolean }[]>`
      SELECT id, name, is_qc, active FROM production.processes WHERE organization_id = ${organizationId} ORDER BY sort_order, name
    `,
    sql<{ id: string; pay_mode: string; requires_ot_hours: boolean; active: boolean }[]>`
      SELECT id, pay_mode, requires_ot_hours, active FROM production.shifts WHERE organization_id = ${organizationId} AND active ORDER BY sort_order, name
    `,
    sql<{ id: string; project_id: string; process_id: string; credit: string; money: string | null; from_day: string; to_day: string | null }[]>`
      SELECT id, project_id, process_id, credit_per_image::text AS credit, money_per_image::text AS money,
        to_char(effective_from, 'YYYY-MM-DD') AS from_day, to_char(effective_to, 'YYYY-MM-DD') AS to_day
      FROM production.credit_rules WHERE organization_id = ${organizationId}
      ORDER BY project_id, process_id, effective_from
    `,
    loadWorkflowModel(sql, organizationId)
  ]);
  const qc = processes.find((row) => row.is_qc && row.active);
  const official = shifts.find((row) => row.pay_mode === "POINTS" && !row.requires_ot_hours);
  const ot = shifts.find((row) => row.pay_mode === "POINTS" && row.requires_ot_hours);
  const khoan = shifts.find((row) => row.pay_mode === "MONEY_IF_KPI");
  if (!qc || !official || !ot || !khoan) {
    throw new Error("Catalog incomplete: need an active QC process and the official / OT / Khoán shifts (run seed-from-worklog.ts first).");
  }
  return {
    organizationId,
    workflow,
    projects,
    processes: new Map(processes.filter((row) => row.active).map((row) => [row.id, { id: row.id, name: row.name, isQc: row.is_qc }])),
    qcProcessId: qc.id,
    shifts: { official: official.id, ot: ot.id, khoan: khoan.id },
    rules: rules.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      processId: row.process_id,
      credit: Number(row.credit),
      money: row.money === null ? null : Number(row.money),
      from: row.from_day,
      to: row.to_day
    }))
  };
};

const ruleAt = (catalog: Catalog, projectId: string, processId: string, day: string) =>
  catalog.rules.find((rule) => rule.projectId === projectId && rule.processId === processId && rule.from <= day && (rule.to === null || day < rule.to)) ?? null;

/** Minutes of retouch per image, from the price (harder work is priced higher). */
const minutesPerImage = (credit: number) => clamp(1.2 + 2.2 * credit, 1.5, 24);

// Manifest ---------------------------------------------------------------------------------------------------

type Manifest = {
  jobIds: string[];
  mayJobIds: string[];
  leaveIds: string[];
  kpiTargetIds: string[];
  runIds: string[];
  savedReportIds: string[];
  reviewKeys: { kind: string; key: string }[];
  creditRuleIds: string[];
  clientIds: string[];
  fieldIds: string[];
  tagIds: string[];
  channelIds: string[];
};
const emptyManifest = (): Manifest => ({
  jobIds: [],
  mayJobIds: [],
  leaveIds: [],
  kpiTargetIds: [],
  runIds: [],
  savedReportIds: [],
  reviewKeys: [],
  creditRuleIds: [],
  clientIds: [],
  fieldIds: [],
  tagIds: [],
  channelIds: []
});

const loadManifest = async (sql: QuerySql, organizationId: string): Promise<Manifest> => {
  const row = (await sql<{ value: Partial<Manifest> }[]>`SELECT value FROM production.settings WHERE organization_id = ${organizationId} AND key = ${MANIFEST_KEY}`)[0];
  return { ...emptyManifest(), ...(row?.value ?? {}) };
};

const saveManifest = async (sql: QuerySql, organizationId: string, manifest: Manifest) => {
  await sql`
    INSERT INTO production.settings (organization_id, key, value) VALUES (${organizationId}, ${MANIFEST_KEY}, ${sql.json(manifest as never)})
    ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
};

// Reset --------------------------------------------------------------------------------------------------------

const removePrevious = async (sql: ReturnType<typeof getSql>, organizationId: string, workflow: Workflow) => {
  const manifest = await loadManifest(sql, organizationId);
  const jobIds = [
    ...new Set([
      ...manifest.jobIds,
      ...(
        await sql<{ id: string }[]>`SELECT id FROM production.jobs WHERE organization_id = ${organizationId} AND drive_link LIKE ${`${DRIVE_PREFIX}%`}`
      ).map((row) => row.id)
    ])
  ];
  const existingJobs = (
    await sql<{ id: string; channel_id: string | null }[]>`SELECT id, channel_id FROM production.jobs WHERE organization_id = ${organizationId} AND id = ANY(${jobIds}::uuid[])`
  );
  const channelIds = [...new Set([...manifest.channelIds, ...existingJobs.flatMap((row) => (row.channel_id ? [row.channel_id] : []))])];
  const taskIds = (await sql<{ id: string }[]>`SELECT id FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ANY(${jobIds}::uuid[])`).map(
    (row) => row.id
  );

  const removedNotifications = await sql`
    DELETE FROM public.notifications
    WHERE organization_id = ${organizationId}
      AND (dedupe_key LIKE 'sim:%'
        OR channel_id = ANY(${channelIds}::uuid[])
        OR (type LIKE 'production.%' AND (
          payload->>'jobId' = ANY(${jobIds}::text[])
          OR payload->>'productionTaskId' = ANY(${taskIds}::text[])
          OR payload->>'leaveId' = ANY(${manifest.leaveIds}::text[])
          OR payload->>'runId' = ANY(${manifest.runIds}::text[]))))
    RETURNING id
  `;
  if (channelIds.length > 0) {
    await sql`DELETE FROM public.channels WHERE organization_id = ${organizationId} AND id = ANY(${channelIds}::uuid[])`;
  }
  await sql.begin(async (tx) => {
    await tx`DELETE FROM production.kpi_settlements WHERE organization_id = ${organizationId} AND run_id = ANY(${manifest.runIds}::uuid[])`;
    await tx`DELETE FROM production.kpi_settlement_runs WHERE organization_id = ${organizationId} AND id = ANY(${manifest.runIds}::uuid[])`;
    await tx`DELETE FROM production.kpi_targets WHERE organization_id = ${organizationId} AND id = ANY(${manifest.kpiTargetIds}::uuid[])`;
    await tx`DELETE FROM production.leave_requests WHERE organization_id = ${organizationId} AND id = ANY(${manifest.leaveIds}::uuid[])`;
    // Leave written by the worklog's --inflight mode (note "seed"): replaced by this script's realistic calendar.
    await tx`DELETE FROM production.leave_requests WHERE organization_id = ${organizationId} AND note = 'seed'`;
    await tx`DELETE FROM production.saved_reports WHERE organization_id = ${organizationId} AND id = ANY(${manifest.savedReportIds}::uuid[])`;
    for (const review of manifest.reviewKeys) {
      await tx`DELETE FROM production.anomaly_reviews WHERE organization_id = ${organizationId} AND kind = ${review.kind} AND subject_key = ${review.key}`;
    }
  });

  // Jobs: the score ledger and task history are append-only by trigger; seed scripts are the one place that may wipe them.
  if (existingJobs.length > 0) {
    const ids = existingJobs.map((row) => row.id);
    await sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`DELETE FROM production.anomaly_reviews WHERE organization_id = ${organizationId} AND task_id = ANY(${taskIds}::uuid[])`;
      await tx`DELETE FROM production.score_entries WHERE organization_id = ${organizationId} AND job_id = ANY(${ids}::uuid[])`;
      await tx`DELETE FROM production.task_logs WHERE organization_id = ${organizationId} AND job_id = ANY(${ids}::uuid[])`;
      await tx`DELETE FROM production.comments WHERE organization_id = ${organizationId} AND job_id = ANY(${ids}::uuid[])`;
      await tx`
        DELETE FROM production.entity_tags WHERE organization_id = ${organizationId}
          AND ((entity = 'JOB' AND entity_id = ANY(${ids}::uuid[])) OR (entity = 'TASK' AND entity_id = ANY(${taskIds}::uuid[])))
      `;
      await tx`UPDATE production.feedbacks SET source_task_id = NULL WHERE organization_id = ${organizationId} AND job_id = ANY(${ids}::uuid[])`;
      await tx`UPDATE production.tasks SET parent_task_id = NULL WHERE organization_id = ${organizationId} AND job_id = ANY(${ids}::uuid[])`;
      await tx`DELETE FROM production.feedbacks WHERE organization_id = ${organizationId} AND job_id = ANY(${ids}::uuid[])`;
      await tx`DELETE FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ANY(${ids}::uuid[])`;
      await tx`DELETE FROM production.jobs WHERE organization_id = ${organizationId} AND id = ANY(${ids}::uuid[])`;
    });
  }

  // May worklog jobs: back to Checked (the worklog replay's end state).
  if (manifest.mayJobIds.length > 0) {
    const checked = statusByCode(workflow, "CHECKED");
    const later = (["COMPLETE", "DELIVERING", "DELIVERED"] as const).map((code) => statusByCode(workflow, code).id);
    await sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`
        DELETE FROM production.task_logs WHERE organization_id = ${organizationId} AND job_id = ANY(${manifest.mayJobIds}::uuid[])
          AND action = 'STATUS' AND to_value->>'code' IN ('COMPLETE', 'DELIVERING', 'DELIVERED')
      `;
      await tx`
        UPDATE production.tasks SET status_id = ${checked.id}, closed_at = NULL, updated_at = coalesce(checked_at, updated_at)
        WHERE organization_id = ${organizationId} AND job_id = ANY(${manifest.mayJobIds}::uuid[]) AND status_id = ANY(${later}::uuid[])
      `;
    });
    for (const jobId of manifest.mayJobIds) {
      const exists = await sql`SELECT 1 FROM production.jobs WHERE organization_id = ${organizationId} AND id = ${jobId}`;
      if (exists.length > 0) {
        await sql.begin((tx) => settleJob(tx, organizationId, workflow, jobId));
      }
    }
  }

  for (const ruleId of manifest.creditRuleIds) {
    const exists = await sql`SELECT 1 FROM production.credit_rules WHERE organization_id = ${organizationId} AND id = ${ruleId}`;
    if (exists.length > 0) {
      await sql.begin((tx) => deleteCreditRuleVersion(tx, organizationId, ruleId));
    }
  }
  await sql`DELETE FROM production.clients WHERE organization_id = ${organizationId} AND id = ANY(${manifest.clientIds}::uuid[])`;
  await sql`DELETE FROM production.tags WHERE organization_id = ${organizationId} AND id = ANY(${manifest.tagIds}::uuid[])`;
  const fieldKeys = (
    await sql<{ key: string }[]>`
      DELETE FROM production.custom_fields WHERE organization_id = ${organizationId} AND id = ANY(${manifest.fieldIds}::uuid[]) AND entity = 'USER' RETURNING key
    `
  ).map((row) => row.key);
  await sql`DELETE FROM production.custom_fields WHERE organization_id = ${organizationId} AND id = ANY(${manifest.fieldIds}::uuid[])`;
  if (fieldKeys.length > 0) {
    await sql`
      UPDATE production.member_profiles SET custom_values = custom_values - ${fieldKeys}::text[]
      WHERE organization_id = ${organizationId} AND custom_values ?| ${fieldKeys}::text[]
    `;
  }
  await sql`DELETE FROM production.settings WHERE organization_id = ${organizationId} AND key = ${MANIFEST_KEY}`;
  console.log(
    `Reset: ${existingJobs.length} simulated jobs, ${manifest.mayJobIds.length} May jobs reverted to Checked, ${manifest.leaveIds.length} leave requests, ` +
      `${manifest.runIds.length} settlement runs, ${removedNotifications.length} notifications, ${channelIds.length} job chats removed.`
  );
};

// Accounts ---------------------------------------------------------------------------------------------------

const passwordFile = new URL("../.env.seed-worklog", import.meta.url);

/** Adds missing SEED_<KEY>_EMAIL / _PASSWORD lines for the accounts this script creates; other lines are kept. */
const ensurePasswords = (keys: AccountSpec[]) => {
  const text = existsSync(passwordFile) ? readFileSync(passwordFile, "utf8") : "# Worklog seed accounts (git-ignored).\n";
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^SEED_([A-Z0-9]+)_PASSWORD=(.+)$/.exec(line.trim());
    if (match?.[1] && match[2]) {
      values.set(match[1], match[2]);
    }
  }
  const additions: string[] = [];
  for (const spec of keys) {
    if (!values.has(spec.key)) {
      const password = `Seed-${randomBytes(9).toString("base64url")}`;
      values.set(spec.key, password);
      additions.push(`SEED_${spec.key}_EMAIL=${spec.email}`, `SEED_${spec.key}_PASSWORD=${password}`);
    }
  }
  if (additions.length > 0) {
    writeFileSync(passwordFile, `${text.replace(/\s*$/, "\n")}${additions.join("\n")}\n`);
  }
  return values;
};

const ensureAccounts = async (sql: QuerySql, organizationId: string) => {
  const created = accountSpecs.filter((spec) => spec.created);
  const passwords = ensurePasswords(created);
  const memberRole = (await sql<{ id: string }[]>`SELECT id FROM public.roles WHERE organization_id = ${organizationId} AND key = 'member' AND deleted_at IS NULL`)[0];
  if (!memberRole) {
    throw new Error('Role "member" not found — run scripts/seed-dev-users.ts first.');
  }
  const ids = new Map<string, string>();
  for (const spec of accountSpecs) {
    let id = (await sql<{ id: string }[]>`SELECT id FROM auth.users WHERE lower(email) = ${spec.email}`)[0]?.id;
    if (!id && spec.created) {
      const response = await fetch(new URL("/auth/v1/admin/users", supabaseUrl), {
        method: "POST",
        headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
        body: JSON.stringify({ email: spec.email, password: passwords.get(spec.key), email_confirm: true, user_metadata: { display_name: spec.name } })
      });
      if (response.status >= 300) {
        throw new Error(`Creating ${spec.email} failed with ${response.status}`);
      }
      id = (await sql<{ id: string }[]>`SELECT id FROM auth.users WHERE lower(email) = ${spec.email}`)[0]?.id;
    }
    if (!id) {
      throw new Error(`Account ${spec.email} missing — run scripts/seed-from-worklog.ts first.`);
    }
    await sql`
      INSERT INTO public.app_users (id, email, display_name, job_title) VALUES (${id}, ${spec.email}, ${spec.name}, ${spec.title})
      ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, job_title = EXCLUDED.job_title, deleted_at = NULL
    `;
    await sql`
      INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, joined_at)
      VALUES (${organizationId}, ${id}, ${memberRole.id}, 'active', ${spec.created ? vn("2026-05-25", "09:00") : vn("2026-04-20", "09:00")})
      ON CONFLICT (organization_id, user_id) WHERE deleted_at IS NULL DO UPDATE SET status = 'active'
    `;
    if (spec.created) {
      await sql`UPDATE public.app_users SET created_at = least(created_at, ${vn("2026-05-25", "09:00")}) WHERE id = ${id}`;
    }
    ids.set(spec.key, id);
  }
  return ids;
};

// Plan types -------------------------------------------------------------------------------------------------

type TaskPlan = {
  key: string;
  kind: TaskKind;
  assigneeId: string;
  qcId: string | null;
  processId: string;
  shiftId: string;
  payMode: "POINTS" | "MONEY_IF_KPI";
  qty: number;
  qtyDone: number;
  assignedAt: Date;
  deadline: Date | null;
  effectiveDeadline: Date;
  note?: string;
  customValues?: Record<string, string>;
  tagNames?: string[];
  sourceKey?: string;
  start?: Date;
  done?: Date;
  otHours?: number;
  checks: { at: Date; pass: boolean; note?: string; redoneAt?: Date }[];
  qcAssign?: { at: Date; qcId: string };
  qtyFix?: { at: Date; qty: number; note: string };
  credit: number;
  qcCredit: number;
};

type Ev =
  | { t: "split"; at: Date; keys: string[] }
  | { t: "start"; at: Date; key: string }
  | { t: "done"; at: Date; key: string }
  | { t: "qcAssign"; at: Date; key: string }
  | { t: "check"; at: Date; key: string; index: number }
  | { t: "redone"; at: Date; key: string; index: number }
  | { t: "qty"; at: Date; key: string }
  | { t: "complete"; at: Date }
  | { t: "delivering"; at: Date }
  | { t: "delivered"; at: Date }
  | { t: "feedback"; at: Date; type: "WRONG" | "EXTRA"; note: string; sourceKey: string }
  | { t: "fbReassign"; at: Date; keys: string[] }
  | { t: "fbResolve"; at: Date }
  | { t: "fbClose"; at: Date; note: string }
  | { t: "archive"; at: Date }
  | { t: "comment"; at: Date; authorId: string; taskKey: string | null; body: string; mentions: string[] };

type FeedbackMode = "HIST" | "CLOSE" | "OPEN" | "REDO_PROCESSING" | "REDO_WAITING_QC";

type JobPlan = {
  index: number;
  code: string;
  name: string;
  projectId: string;
  projectCode: string;
  clientIndex: number;
  team: 0 | 1;
  leaderId: string;
  accountId: string;
  createdAt: Date;
  deadline: Date;
  totalImages: number;
  driveLink: string;
  customValues: Record<string, string>;
  tagNames: string[];
  splitAt: Date;
  tasks: Map<string, TaskPlan>;
  normalKeys: string[];
  completeAt: Date;
  deliveringAt: Date;
  events: Ev[];
  feedback?: { mode: FeedbackMode; at: Date; type: "WRONG" | "EXTRA"; sourceKey: string };
  archivedAt?: Date;
  cancelled?: boolean;
  rush: boolean;
  vip: boolean;
};

type Plan = { jobs: JobPlan[]; leaves: LeavePlan[]; lateLeave: LeavePlan | null };

type LeavePlan = {
  userId: string;
  from: string;
  to: string;
  part: LeavePart;
  note: string;
  status: "APPROVED" | "REJECTED" | "CANCELLED" | "PENDING";
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  decisionNote: string | null;
  cancelledAt: Date | null;
};

// Leave plan -------------------------------------------------------------------------------------------------

const planLeaves = (people: Map<string, Person>): { leaves: LeavePlan[]; lateLeave: LeavePlan | null } => {
  const rng = new Rng("leave");
  const leaves: LeavePlan[] = [];
  const taken = new Map<string, { from: string; to: string }[]>();
  const leaderOf = (person: Person) => (person.isLeader ? people.get("ADMIN01")!.id : people.get(person.team === 1 ? "LEAD02" : "LEAD01")!.id);
  const overlaps = (userId: string, from: string, to: string) => (taken.get(userId) ?? []).some((span) => !(to < span.from || from > span.to));
  const randomWorkday = (from: string, to: string) => {
    for (let guard = 0; guard < 50; guard += 1) {
      const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
      const day = addDays(from, rng.int(0, span));
      if (isWorkday(day)) {
        return day;
      }
    }
    return from;
  };
  const add = (
    person: Person,
    from: string,
    length: number,
    part: LeavePart,
    status: LeavePlan["status"],
    createdAt: Date,
    decidedAt: Date | null,
    extra: Partial<LeavePlan> = {}
  ) => {
    let to = from;
    for (let count = 1; count < length; ) {
      to = addDays(to, 1);
      if (weekday(to) !== 0) {
        count += 1;
      }
    }
    if ((status === "APPROVED" || status === "PENDING") && overlaps(person.id, from, to)) {
      return null;
    }
    const plan: LeavePlan = {
      userId: person.id,
      from,
      to,
      part,
      note: rng.pick(leaveReasons),
      status,
      createdAt,
      decidedAt,
      decidedBy: decidedAt ? leaderOf(person) : null,
      decisionNote: status === "REJECTED" ? rng.pick(rejectNotes) : null,
      cancelledAt: null,
      ...extra
    };
    if (status === "APPROVED" || status === "PENDING") {
      taken.set(person.id, [...(taken.get(person.id) ?? []), { from, to }]);
    }
    leaves.push(plan);
    return plan;
  };
  const officeTime = (day: string) => vn(day, `${pad2(rng.int(8, 16))}:${pad2(rng.int(0, 59))}`);

  const members = [...people.values()].filter((person) => person.profile || person.isLeader);
  // History: June → last week.
  for (const person of members) {
    const count = person.isLeader ? 1 : rng.int(2, 3);
    for (let index = 0; index < count; index += 1) {
      const from = randomWorkday("2026-06-08", addDays(TODAY, -8));
      const roll = rng.next();
      const part: LeavePart = roll < 0.22 ? "MORNING" : roll < 0.4 ? "AFTERNOON" : "FULL_DAY";
      const length = part === "FULL_DAY" ? rng.weighted([1, 2, 3], (value) => (value === 1 ? 6 : value === 2 ? 3 : 1)) : 1;
      const createdAt = officeTime(addDays(from, -rng.int(3, 12)));
      const decidedAt = advance(createdAt, rng.int(30, 900), windowsFor(null, "leader"));
      const statusRoll = rng.next();
      if (statusRoll < 0.72) {
        add(person, from, length, part, "APPROVED", createdAt, decidedAt);
      } else if (statusRoll < 0.86) {
        add(person, from, length, part, "REJECTED", createdAt, decidedAt);
      } else {
        const approvedFirst = rng.chance(0.5);
        add(person, from, length, part, "CANCELLED", createdAt, approvedFirst ? decidedAt : null, {
          cancelledAt: plusMinutes(approvedFirst ? decidedAt : createdAt, rng.int(120, 2400))
        });
      }
    }
  }
  const byKey = (key: string) => people.get(key)!;
  // On leave right now (affects today's workload) and upcoming approved leave.
  add(byKey("NV11"), addDays(TODAY, -1), 2, "FULL_DAY", "APPROVED", officeTime(addDays(TODAY, -8)), officeTime(addDays(TODAY, -7)), { note: "Về quê dự đám cưới em gái" });
  const upcoming: [string, number, number, LeavePart][] = [
    ["NV01", 2, 1, "FULL_DAY"],
    ["NV05", 4, 1, "MORNING"],
    ["NV09", 8, 1, "FULL_DAY"],
    ["NV14", 11, 3, "FULL_DAY"],
    ["NV07", 16, 1, "AFTERNOON"],
    ["NV03", 23, 2, "FULL_DAY"],
    ["LEAD01", 30, 1, "FULL_DAY"],
    ["NV12", 40, 2, "FULL_DAY"]
  ];
  for (const [key, offset, length, part] of upcoming) {
    let from = addDays(TODAY, offset);
    while (!isWorkday(from)) {
      from = addDays(from, 1);
    }
    const createdAt = officeTime(addDays(TODAY, -rng.int(6, 12)));
    add(byKey(key), from, length, part, "APPROVED", createdAt, advance(createdAt, rng.int(60, 600), windowsFor(null, "leader")));
  }
  // Waiting for a decision (created during the last days → leaders and admins get "đơn nghỉ mới").
  const pending: [string, number, number, LeavePart, number][] = [
    ["NV03", 5, 1, "AFTERNOON", 1],
    ["NV13", 9, 1, "FULL_DAY", 2],
    ["NV15", 13, 2, "FULL_DAY", 3],
    ["NV04", 6, 1, "MORNING", 0],
    ["NV08", 12, 1, "FULL_DAY", 2],
    ["NV10", 20, 3, "FULL_DAY", 4],
    ["LEAD02", 17, 1, "FULL_DAY", 1]
  ];
  for (const [key, offset, length, part, ago] of pending) {
    let from = addDays(TODAY, offset);
    while (!isWorkday(from)) {
      from = addDays(from, 1);
    }
    let day = addDays(TODAY, -ago);
    while (!isWorkday(day)) {
      day = addDays(day, -1);
    }
    const createdAt = minDate(officeTime(day), plusMinutes(NOW, -rng.int(20, 90)));
    add(byKey(key), from, length, part, "PENDING", createdAt, null);
  }
  // A sick day approved late (after the September close) — the reason for the Admin's manual re-run.
  let lateFrom = "2026-09-18";
  while (!isWorkday(lateFrom) || overlaps(byKey("NV12").id, lateFrom, lateFrom)) {
    lateFrom = addDays(lateFrom, -1);
  }
  const rerunDay = rerunDayOf();
  const lateLeave: LeavePlan = {
    userId: byKey("NV12").id,
    from: lateFrom,
    to: lateFrom,
    part: "FULL_DAY",
    note: "Nghỉ ốm (bổ sung giấy khám bệnh)",
    status: "APPROVED",
    createdAt: vn(addDays(rerunDay, -1), "09:20"),
    decidedAt: vn(rerunDay, "09:05"),
    decidedBy: byKey("LEAD02").id,
    decisionNote: "Đã nhận giấy khám, duyệt bổ sung.",
    cancelledAt: null
  };
  return { leaves, lateLeave };
};

const minDate = (...dates: Date[]) => new Date(Math.min(...dates.map((date) => date.getTime())));

/** Day of the Admin's manual settlement re-run: about four working days ago (inside the inbox window). */
const rerunDayOf = () => {
  let day = addDays(TODAY, -4);
  while (!isWorkday(day)) {
    day = addDays(day, -1);
  }
  return day;
};

// Job plan ---------------------------------------------------------------------------------------------------

type PlanContext = {
  catalog: Catalog;
  people: Map<string, Person>;
  clientOfProject: Map<string, number>;
  existingCodes: Set<string>;
};

const debugLoad = new Map<string, number>();

const planJobs = (context: PlanContext): JobPlan[] => {
  // Each day and each job draw from their own stream: a change near "now" (the real clock) never reshuffles the past.
  let rng = new Rng("jobs");
  const { catalog, people } = context;
  const busy = new Map<string, number>();
  const otBusy = new Map<string, number>();
  const staff = [...people.values()].filter((person) => person.profile);
  const staffByTeam = [staff.filter((person) => person.team === 0), staff.filter((person) => person.team === 1)] as const;
  const leaders = [people.get("LEAD01")!, people.get("LEAD02")!] as const;
  const qcByTeam = [
    [...staffByTeam[0].filter((person) => person.isQc), leaders[0]],
    [...staffByTeam[1].filter((person) => person.isQc), leaders[1]]
  ] as const;
  const accounts = [people.get("ACC01")!, people.get("ACC02")!];
  const superadmin = people.get("SUPER");
  const codeCount = new Map<string, number>();
  // One of today's late arrivals is a rush job due tonight (OT in progress, "sắp đến hạn" on the dashboards).
  const rushTimes = new Set<number>();

  const eligible = catalog.projects
    .filter((project) => project.active)
    .map((project) => ({
      project,
      weight: 0.4 + new Rng(`project:${project.code}`).next() * 1.6
    }))
    .filter(({ project }) =>
      catalog.rules.some((rule) => rule.projectId === project.id && rule.processId === catalog.qcProcessId) &&
      catalog.rules.some((rule) => rule.projectId === project.id && rule.processId !== catalog.qcProcessId && catalog.processes.has(rule.processId))
    );
  if (eligible.length === 0) {
    throw new Error("No project has both a work price and a Checking price.");
  }
  // The deliberate "Thiếu đơn giá" pair: a priced project with a process that has no price for it.
  const unpricedProcess = (projectId: string) =>
    [...catalog.processes.values()]
      .filter((process) => !process.isQc && !catalog.rules.some((rule) => rule.projectId === projectId && rule.processId === process.id))
      .sort((a, b) => hashText(`m:${a.name}`) - hashText(`m:${b.name}`))[0];
  let missingUsed = 0;
  let fastUsed = 0;

  const staffWin = (person: Person) => windowsFor(person.id, person.isLeader ? "leader" : "staff");
  const expectedStart = (person: Person, at: Date) =>
    advance(new Date(Math.max(at.getTime() + 10 * 60_000, busy.get(person.id) ?? 0)), 0, staffWin(person)).getTime();

  /** The leader gives the chunk to someone who can finish it before the deadline (mostly; sometimes nobody can). */
  const pickWorker = (team: 0 | 1, at: Date, used: Set<string>, workMinutes: number, deadline: Date) => {
    const home = rng.chance(0.86) ? team : ((1 - team) as 0 | 1);
    let pool = staffByTeam[home].filter((person) => !used.has(person.id));
    if (pool.length < 3) {
      pool = [...staffByTeam[home]];
    }
    const scored = pool.map((person) => {
      const start = expectedStart(person, at);
      return { person, start, finish: advance(new Date(start), workMinutes * person.profile!.speed, staffWin(person)).getTime() };
    });
    const onTime = scored.filter((item) => item.finish <= deadline.getTime() - 60 * 60_000);
    if (onTime.length === 0 || rng.chance(0.03)) {
      if (process.env.SIM_DEBUG) console.log(`fallback onTime=${onTime.length} team=${home} at=${at.toISOString()} work=${Math.round(workMinutes)} window=${Math.round((deadline.getTime() - at.getTime()) / 60_000)} queue=${Math.round((Math.min(...scored.map((item) => item.start)) - at.getTime()) / 3_600_000)}h`);
      return [...scored].sort((a, b) => a.finish - b.finish)[rng.chance(0.75) ? 0 : Math.min(1, scored.length - 1)]!.person;
    }
    const earliest = Math.min(...onTime.map((item) => item.start));
    const ready = onTime.filter((item) => item.start <= earliest + 150 * 60_000);
    return rng.weighted(ready, (item) => item.person.profile!.share * (item.start <= at.getTime() + 45 * 60_000 ? 1.3 : 1)).person;
  };
  const pickQc = (team: 0 | 1, workerId: string) => {
    const pool = qcByTeam[rng.chance(0.9) ? team : ((1 - team) as 0 | 1)].filter((person) => person.id !== workerId);
    return rng.weighted(pool, (person) => (person.isLeader ? 1.3 : 1)).id;
  };
  const qcWin = (qcId: string) => {
    const person = [...people.values()].find((item) => item.id === qcId)!;
    return windowsFor(person.id, person.isLeader ? "leader" : "staff");
  };
  const personById = new Map([...people.values()].map((person) => [person.id, person]));

  /** Times of one task from Done on: QC (assigned later or not), fails and re-work, qty correction. */
  const planChecks = (job: { leaderId: string; team: 0 | 1 }, task: TaskPlan, worker: Person, mpi: number, firstReadyAt: Date, failRate: number) => {
    let ready = firstReadyAt;
    if (!task.qcId) {
      const qcId = pickQc(job.team, worker.id);
      // Work finished during the last day mostly waits for the Leader to pick a QC on Monday morning.
      const waitsForMonday = rng.chance(0.7) && ready.getTime() > NOW.getTime() - 30 * 3_600_000;
      task.qcAssign = { at: advance(waitsForMonday ? maxDate(ready, NOW) : ready, waitsForMonday ? rng.int(20, 120) : rng.int(30, 420), windowsFor(job.leaderId, "leader")), qcId };
      ready = task.qcAssign.at;
    }
    const qcId = task.qcAssign?.qcId ?? task.qcId!;
    // QC works in batches: a check comes 20 minutes to most of a working day after Done.
    const qcBacklog = rng.chance(0.5) && ready.getTime() > NOW.getTime() - 30 * 3_600_000;
    let check = qcBacklog
      ? advance(maxDate(ready, NOW), rng.int(20, 240), qcWin(qcId))
      : advance(ready, rng.chance(0.7) ? rng.int(20, 180) : rng.int(180, 420), qcWin(qcId));
    let failures = 0;
    while (failures < 2 && rng.chance(failures === 0 ? failRate : 0.1)) {
      const reworkStart = advance(check, rng.int(10, 60), staffWin(worker));
      const redone = advance(reworkStart, Math.max(10, task.qtyDone * mpi * 0.12 * (worker.profile?.speed ?? 1)), staffWin(worker));
      task.checks.push({ at: check, pass: false, note: failures === 0 ? rng.pick(qcFailNotes) : rng.pick(qcFailAgainNotes), redoneAt: redone });
      failures += 1;
      check = advance(redone, rng.int(10, 150), qcWin(qcId));
    }
    task.checks.push({ at: check, pass: true });
  };

  const jobs: JobPlan[] = [];
  for (let day = SIM_FROM; day <= TODAY; day = addDays(day, 1)) {
    if (!isWorkday(day)) {
      continue;
    }
    const saturday = weekday(day) === 6;
    rng = new Rng(`day:${day}`);
    const count = saturday ? rng.int(2, 4) : rng.weighted([3, 4, 5, 6, 7], (value) => [1, 3, 4, 3, 1][value - 3]!);
    const times = Array.from({ length: count }, () => {
      const roll = rng.next();
      const minute = saturday
        ? rng.int(8 * 60 + 5, 16 * 60 + 30)
        : roll < 0.42
          ? rng.int(8 * 60 + 5, 10 * 60 + 30)
          : roll < 0.78
            ? rng.int(10 * 60 + 30, 14 * 60)
            : rng.int(14 * 60, 16 * 60 + 50);
      return vn(day, `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`);
    });
    if (day === TODAY) {
      // Late arrivals of today: split before the evening, picked up the next working morning ("Mới giao").
      const rushAt = vn(day, `16:${pad2(rng.int(5, 25))}`);
      rushTimes.add(rushAt.getTime());
      times.push(rushAt, vn(day, `16:${pad2(rng.int(30, 55))}`));
    }
    times.sort((a, b) => a.getTime() - b.getTime());

    for (const [slot, createdAt] of times.entries()) {
      if (createdAt > NOW) {
        continue;
      }
      rng = new Rng(`job:${day}:${slot}`);
      const { project } = rng.weighted(eligible, (item) => item.weight);
      const clientIndex = context.clientOfProject.get(project.id) ?? 0;
      const team = (rng.chance(0.85) ? clientIndex % 2 : 1 - (clientIndex % 2)) as 0 | 1;
      const leader = leaders[team];
      const account = rng.chance(0.58) ? accounts[0]! : accounts[1]!;
      const forcedRush = rushTimes.has(createdAt.getTime());
      const totalImages = forcedRush ? rng.int(28, 46) : Math.round(clamp(rng.logNormal(85, 0.7), 20, 400));
      const client = clientSpecs[clientIndex % clientSpecs.length]!;

      // Processes priced for the project on that day (Checking excluded); sometimes two in one job.
      const priced = catalog.rules
        .filter((rule) => rule.projectId === project.id && rule.processId !== catalog.qcProcessId && catalog.processes.has(rule.processId))
        .filter((rule) => rule.from <= day && (rule.to === null || day < rule.to));
      const main = rng.weighted(priced, (rule) => 1 + (hashText(`${project.code}:${rule.processId}`) % 3));
      const workHours = (totalImages * minutesPerImage(main.credit)) / 60;

      // Deadline: 1–3 days (big jobs get more), rush jobs the same evening / next morning; never on Sunday.
      const rush = forcedRush || (workHours <= 14 && rng.chance(0.07));
      let deadline: Date;
      if (rush) {
        let next = addDays(day, 1);
        while (!isWorkday(next)) next = addDays(next, 1);
        deadline = forcedRush ? vn(day, "21:00") : createdAt.getUTCHours() + 7 < 13 ? vn(day, rng.pick(["20:00", "21:00"])) : vn(next, "10:00");
      } else {
        const offset = Math.max(rng.weighted([1, 2, 3], (value) => (value === 1 ? 45 : value === 2 ? 35 : 20)), Math.ceil(workHours / 20));
        let target = addDays(day, offset);
        while (!isWorkday(target)) {
          target = addDays(target, 1);
        }
        deadline = vn(target, rng.weighted(["12:00", "17:00", "17:30"], (value) => (value === "17:00" ? 6 : 2)));
      }
      if (businessDay(deadline) !== day && weekday(businessDay(deadline)) === 0) {
        deadline = vn(addDays(businessDay(deadline), 1), "10:00");
      }

      // Code & name.
      const baseCode = `${project.code} ${day.replaceAll("-", "")}`;
      let code = baseCode;
      for (let suffix = (codeCount.get(baseCode) ?? 0) + 1; ; suffix += 1) {
        code = suffix === 1 ? baseCode : `${baseCode}-${suffix}`;
        codeCount.set(baseCode, suffix);
        if (!context.existingCodes.has(code.toLowerCase())) {
          break;
        }
      }
      const collections = collectionsByMonth[day.slice(5, 7)] ?? ["Thu Đông 2026"];
      const name = `${client.brand} – ${rng.pick(jobNameTemplates)(rng.pick(collections), rng.int(1, 4))}`;
      const vip = client.priority === "vip";
      const urgency = rush ? "rat_gap" : deadline.getTime() - createdAt.getTime() < 30 * 3_600_000 && rng.chance(0.5) ? "gap" : "thuong";
      const customValues: Record<string, string> = {
        dinh_dang_xuat: rng.chance(0.85) ? client.format : rng.pick(["jpg_srgb", "png_trong", "webp"]),
        uu_tien: urgency
      };
      if (rng.chance(0.6)) {
        customValues.ma_po = `PO-${day.slice(2).replaceAll("-", "")}-${pad2(rng.int(1, 40))}`;
      }
      if (rng.chance(0.7)) {
        customValues.ngay_chup = addDays(day, -rng.int(1, 4));
      }
      if (rng.chance(0.25)) {
        customValues.ghi_chu_khach = rng.pick(customerNotes);
      }
      if (day >= addDays(TODAY, -45)) {
        customValues.ma_don_hang = orderNumberOf(code, day);
      }
      const tagNames: string[] = [];
      if (vip) tagNames.push("VIP");
      if (urgency !== "thuong") tagNames.push("Gấp");
      if (rng.chance(0.05)) tagNames.push("Mẫu mới");
      if (rng.chance(0.07)) tagNames.push("Cần kiểm kỹ");
      if (/Lookbook/.test(name)) tagNames.push("Lookbook");
      if (/Sale|Chiến dịch/.test(name) && rng.chance(0.6)) tagNames.push("Sale campaign");
      if (/model/i.test(name)) tagNames.push("Ảnh model");

      const leaderWin = windowsFor(leader.id, "leader");
      const splitAt = advance(createdAt, rng.int(6, 45), leaderWin);
      const job: JobPlan = {
        index: jobs.length,
        code,
        name,
        projectId: project.id,
        projectCode: project.code,
        clientIndex,
        team,
        leaderId: leader.id,
        accountId: account.id,
        createdAt,
        deadline,
        totalImages,
        driveLink: `${DRIVE_PREFIX}${day.slice(0, 7).replace("-", "/")}/${code.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        customValues,
        tagNames,
        splitAt,
        tasks: new Map(),
        normalKeys: [],
        completeAt: splitAt,
        deliveringAt: splitAt,
        events: [],
        rush,
        vip
      };

      const portions: { processId: string; qty: number }[] = [];
      if (priced.length > 1 && rng.chance(0.3) && totalImages >= 30) {
        const other = rng.pick(priced.filter((rule) => rule.processId !== main.processId));
        const mainQty = Math.round(totalImages * rng.float(0.55, 0.85));
        portions.push({ processId: main.processId, qty: mainQty }, { processId: other.processId, qty: totalImages - mainQty });
      } else {
        portions.push({ processId: main.processId, qty: totalImages });
      }
      // "Thiếu đơn giá": twice in the last two weeks, a small extra task in a process without a price.
      const missingProcess = unpricedProcess(project.id);
      if (rng.chance(0.12) && missingProcess && missingUsed < 2 && createdAt.getTime() > NOW.getTime() - 12 * 86_400_000 && totalImages >= 30) {
        const extra = Math.max(5, Math.round(totalImages * 0.15));
        portions[0]!.qty -= extra;
        portions.push({ processId: missingProcess.id, qty: extra });
        missingUsed += 1;
      }

      const used = new Set<string>();
      let counter = 0;
      for (const portion of portions) {
        const rule = ruleAt(catalog, project.id, portion.processId, day);
        const mpi = minutesPerImage(rule?.credit ?? 1.5);
        // The leader sizes the chunks so one person can finish before the deadline.
        const available = workingMinutesBetween(splitAt, new Date(deadline.getTime() - project.qcBuffer * 3_600_000));
        const chunkMinutes = clamp(Math.min(rush ? rng.int(60, 150) : rng.int(150, 330), available * 0.5), 40, 330);
        const chunks = clamp(Math.round((portion.qty * mpi) / chunkMinutes), 1, Math.min(8, Math.max(1, Math.floor(portion.qty / 6))));
        const sizes = Array.from({ length: chunks }, () => Math.floor(portion.qty / chunks));
        for (let rest = portion.qty - sizes.reduce((sum, value) => sum + value, 0), index = 0; rest > 0; rest -= 1, index += 1) {
          sizes[index % chunks]! += 1;
        }
        for (const qty of sizes) {
          const selfAssign = rng.chance(0.012);
          const taskDeadline = new Date(deadline.getTime() - project.qcBuffer * 3_600_000);
          const worker = selfAssign ? leader : pickWorker(team, splitAt, used, qty * mpi, taskDeadline);
          used.add(worker.id);
          const key = `t${(counter += 1)}`;
          const khoanOk = rule?.money !== null && rule?.money !== undefined;
          const shiftRoll = rng.next();
          const khoanShare = worker.profile?.khoan ?? 0.1;
          let shift = forcedRush || (rush && shiftRoll < 0.6) ? "ot" : khoanOk && shiftRoll < khoanShare ? "khoan" : shiftRoll > 0.86 ? "ot" : "official";
          // Work time.
          const profile = worker.profile ?? { speed: 1, failRate: 0.04 };
          let duration = qty * mpi * profile.speed * rng.logNormal(1, 0.22);
          if (rng.chance(0.04)) {
            duration *= rng.float(1.8, 2.8);
          }
          const pickup = rng.int(5, 35);
          if (shift === "ot") {
            // OT only when the evening(s) before the deadline can hold the work.
            const otWin = windowsFor(worker.id, "ot");
            const otStart = advance(new Date(Math.max(splitAt.getTime() + pickup * 60_000, otBusy.get(worker.id) ?? 0)), 0, otWin);
            if (advance(otStart, qty * mpi * profile.speed, otWin) > taskDeadline) {
              shift = "official";
            }
          }
          const noQc = rng.chance(splitAt.getTime() > NOW.getTime() - 36 * 3_600_000 ? 0.4 : 0.07);
          const qcId = selfAssign ? pickQc(team, worker.id) : noQc ? null : pickQc(team, worker.id);
          let qtyDone = qty;
          const qtyRoll = rng.next();
          if (qtyRoll < 0.035) {
            qtyDone = Math.max(1, qty - rng.int(1, Math.max(1, Math.round(qty * 0.12))));
          } else if (qtyRoll < 0.043) {
            qtyDone = qty + rng.int(1, 3);
          }
          const difficulty = rng.next();
          const task: TaskPlan = {
            key,
            kind: "NORMAL",
            assigneeId: worker.id,
            qcId,
            processId: portion.processId,
            shiftId: shift === "ot" ? catalog.shifts.ot : shift === "khoan" ? catalog.shifts.khoan : catalog.shifts.official,
            payMode: shift === "khoan" ? "MONEY_IF_KPI" : "POINTS",
            qty,
            qtyDone,
            assignedAt: splitAt,
            deadline: null,
            effectiveDeadline: new Date(deadline.getTime() - project.qcBuffer * 3_600_000),
            checks: [],
            credit: rule?.credit ?? 0,
            qcCredit: ruleAt(catalog, project.id, catalog.qcProcessId, day)?.credit ?? 0
          };
          if (difficulty < 0.5) {
            task.customValues = { do_kho: difficulty < 0.2 ? "de" : difficulty < 0.4 ? "tb" : "kho" };
            if (rng.chance(0.15)) {
              task.customValues.ghi_chu_ky_thuat = rng.pick(techNotes);
            }
          }
          if (rng.chance(0.12)) {
            task.note = rng.pick(taskNotes);
          }
          if (job.tagNames.includes("Cần kiểm kỹ") && rng.chance(0.5)) {
            task.tagNames = ["Cần kiểm kỹ"];
          }
          if (process.env.SIM_DEBUG) {
            const month = day.slice(0, 7);
            debugLoad.set(`${month}|${shift === "ot" ? "ot" : "day"}`, (debugLoad.get(`${month}|${shift === "ot" ? "ot" : "day"}`) ?? 0) + duration);
          }
          const recent = createdAt.getTime() > NOW.getTime() - 26 * 86_400_000;
          if (rng.chance(0.03) && recent && qty <= 30 && fastUsed < 6) {
            fastUsed += 1;
            task.start = plusMinutes(splitAt, 1);
            task.done = plusMinutes(splitAt, rng.float(2.2, 4.6));
          } else if (shift === "ot") {
            const otWin = windowsFor(worker.id, "ot");
            task.start = advance(new Date(Math.max(splitAt.getTime() + pickup * 60_000, otBusy.get(worker.id) ?? 0)), 0, otWin);
            task.done = advance(task.start, duration, otWin);
            otBusy.set(worker.id, task.done.getTime());
            task.otHours = clamp(Math.round(duration / 30) / 2, 0.5, 12);
          } else {
            // Work handed out late in the afternoon is picked up the next working morning.
            const lateSplit = (splitAt.getTime() - startOfBusinessDay(businessDay(splitAt)).getTime()) / 60_000 >= 16 * 60 + 10;
            const pickupAt = lateSplit ? plusMinutes(vn(nextWorkday(businessDay(splitAt)), "08:00"), pickup) : plusMinutes(splitAt, pickup);
            task.start = advance(new Date(Math.max(pickupAt.getTime(), busy.get(worker.id) ?? 0)), 0, staffWin(worker));
            task.done = advance(task.start, duration, staffWin(worker));
            busy.set(worker.id, task.done.getTime());
          }
          // Stalled work right now: deadline passed during the last two days but the task is still open.
          const stallRoll = rng.next();
          if (
            task.effectiveDeadline < NOW &&
            task.effectiveDeadline.getTime() > NOW.getTime() - 60 * 3_600_000 &&
            task.done <= NOW &&
            splitAt < task.effectiveDeadline &&
            stallRoll < 0.18
          ) {
            task.done = advance(NOW, rng.int(40, 480), shift === "ot" ? windowsFor(worker.id, "ot") : staffWin(worker));
          }
          planChecks(job, task, worker, mpi, task.done, (profile as { failRate: number }).failRate);
          if (rng.chance(0.022)) {
            const less = rng.chance(0.7);
            const delta = rng.int(1, 4);
            const qtyNew = less ? Math.max(1, task.qtyDone - delta) : task.qtyDone + delta;
            if (qtyNew !== task.qtyDone) {
              task.qtyFix = {
                at: advance(task.done, rng.int(15, 240), leaderWin),
                qty: qtyNew,
                note: (less ? rng.pick(qtyLessNotes) : rng.pick(qtyMoreNotes)).replace("{n}", String(Math.abs(qtyNew - task.qtyDone)))
              };
            }
          }
          job.tasks.set(key, task);
          job.normalKeys.push(key);
        }
      }
      const lastCheck = Math.max(...job.normalKeys.map((key) => job.tasks.get(key)!.checks.at(-1)!.at.getTime()));
      // End-of-week backlog: part of what happened in the last day waits for Monday.
      const backlog = (at: Date, probability: number) => rng.chance(probability) && at.getTime() > NOW.getTime() - 30 * 3_600_000;
      const checkedAll = new Date(lastCheck);
      job.completeAt = backlog(checkedAll, 0.35) ? advance(maxDate(checkedAll, NOW), rng.int(10, 120), leaderWin) : advance(checkedAll, rng.int(10, 200), leaderWin);
      job.deliveringAt = backlog(job.completeAt, 0.75)
        ? advance(maxDate(job.completeAt, NOW), rng.int(15, 120), windowsFor(account.id, "account"))
        : advance(job.completeAt, rng.chance(0.7) ? rng.int(10, 120) : rng.int(120, 600), windowsFor(account.id, "account"));
      jobs.push(job);
    }
  }

  // Delivery, feedback, archive, comments — after every job is scheduled (they do not use work capacity).
  const pick = (label: string) => new Rng(`tail-pick:${label}`);
  const forcedModes: FeedbackMode[] = ["REDO_WAITING_QC", "REDO_PROCESSING", "OPEN"];
  const forcedCandidates = pick("feedback").shuffle(
    jobs.filter((job) => job.deliveringAt.getTime() < NOW.getTime() - (5 * 3_600_000) && job.deliveringAt.getTime() > NOW.getTime() - 80 * 3_600_000)
  );
  const forced = new Map<number, FeedbackMode>();
  for (const job of forcedCandidates) {
    const mode = forcedModes[forced.size];
    if (!mode) break;
    const minAge = mode === "OPEN" ? 5 : 28;
    if (job.deliveringAt.getTime() < NOW.getTime() - minAge * 3_600_000) {
      forced.set(job.index, mode);
    }
  }
  const cancelCandidate = pick("cancel").shuffle(
    jobs.filter(
      (job) =>
        job.createdAt.getTime() > NOW.getTime() - 5 * 86_400_000 &&
        job.createdAt.getTime() < NOW.getTime() - 3 * 86_400_000 &&
        job.normalKeys.length >= 2 &&
        !forced.has(job.index)
    )
  )[0];
  const archiveOld = new Set(
    pick("archive")
      .shuffle(jobs.filter((job) => job.createdAt < vn("2026-06-27", "00:00")))
      .slice(0, 6)
      .map((job) => job.index)
  );
  let closures = 0;

  for (const job of jobs) {
    const tail = new Rng(`tail:${job.code}`);
    const accountWin = windowsFor(job.accountId, "account");
    const leaderWin = windowsFor(job.leaderId, "leader");
    const ev: Ev[] = [{ t: "split", at: job.splitAt, keys: [...job.normalKeys] }];
    const pushTask = (task: TaskPlan) => {
      if (task.start) ev.push({ t: "start", at: task.start, key: task.key });
      if (task.done) ev.push({ t: "done", at: task.done, key: task.key });
      if (task.qcAssign) ev.push({ t: "qcAssign", at: task.qcAssign.at, key: task.key });
      task.checks.forEach((check, index) => {
        ev.push({ t: "check", at: check.at, key: task.key, index });
        if (check.redoneAt) ev.push({ t: "redone", at: check.redoneAt, key: task.key, index });
      });
      if (task.qtyFix) ev.push({ t: "qty", at: task.qtyFix.at, key: task.key });
    };
    job.normalKeys.forEach((key) => pushTask(job.tasks.get(key)!));
    ev.push({ t: "complete", at: job.completeAt }, { t: "delivering", at: job.deliveringAt });

    const forcedMode = forced.get(job.index);
    const historical = job.deliveringAt.getTime() < NOW.getTime() - 30 * 3_600_000 && tail.chance(0.05);
    if (forcedMode || historical) {
      const mode: FeedbackMode = forcedMode ?? (closures < 2 || tail.chance(0.05) ? "CLOSE" : "HIST");
      if (mode === "CLOSE") closures += 1;
      const type = tail.chance(0.55) ? "WRONG" : "EXTRA";
      const sourceKey = tail.pick(job.normalKeys);
      const source = job.tasks.get(sourceKey)!;
      let fbAt = advance(job.deliveringAt, tail.int(60, forcedMode ? 240 : 900), accountWin);
      if (mode === "OPEN") {
        fbAt = advance(maxDate(plusMinutes(job.deliveringAt, 60), plusMinutes(NOW, -6 * 60)), 0, accountWin);
      }
      job.feedback = { mode, at: fbAt, type, sourceKey };
      ev.push({ t: "feedback", at: fbAt, type, note: tail.pick(type === "WRONG" ? feedbackWrongNotes : feedbackExtraNotes), sourceKey });
      if (mode === "CLOSE") {
        const closeAt = advance(fbAt, tail.int(30, 360), accountWin);
        const again = advance(closeAt, tail.int(10, 60), accountWin);
        ev.push({ t: "fbClose", at: closeAt, note: tail.pick(feedbackCloseNotes) }, { t: "delivering", at: again }, { t: "delivered", at: advance(again, tail.int(60, 900), accountWin) });
      } else {
        const reassignAt = mode === "OPEN" ? advance(NOW, tail.int(20, 90), leaderWin) : advance(fbAt, tail.int(15, 150), leaderWin);
        const keys: string[] = [];
        const count = tail.chance(0.8) ? 1 : 2;
        for (let index = 0; index < count; index += 1) {
          const sourceWorker = [...people.values()].find((person) => person.id === source.assigneeId)!;
          const worker = sourceWorker.profile && tail.chance(0.85) ? sourceWorker : tail.pick(staffByTeam[job.team]);
          const processId =
            type === "EXTRA" && tail.chance(0.5)
              ? tail.pick(
                  catalog.rules
                    .filter((rule) => rule.projectId === job.projectId && rule.processId !== catalog.qcProcessId && catalog.processes.has(rule.processId))
                    .map((rule) => rule.processId)
                )
              : source.processId;
          const day = businessDay(reassignAt);
          const rule = ruleAt(catalog, job.projectId, processId, day);
          const mpi = minutesPerImage(rule?.credit ?? 1.5);
          const qty = Math.max(2, Math.round(source.qtyDone * tail.float(0.08, 0.35)));
          const key = `f${index + 1}`;
          const qcId = source.qcId ?? source.qcAssign?.qcId ?? null;
          const fbTask: TaskPlan = {
            key,
            kind: type === "WRONG" ? "FB_WRONG" : "FB_EXTRA",
            assigneeId: worker.id,
            qcId: qcId && qcId !== worker.id ? qcId : pickQc(job.team, worker.id),
            processId,
            shiftId: catalog.shifts.official,
            payMode: "POINTS",
            qty,
            qtyDone: qty,
            assignedAt: reassignAt,
            deadline: null,
            effectiveDeadline: feedbackTaskDeadline({
              jobDeadline: job.deadline,
              qcBufferHours: catalog.projects.find((project) => project.id === job.projectId)?.qcBuffer ?? 0,
              now: reassignAt,
              source: { assignedAt: source.assignedAt, deadline: source.effectiveDeadline }
            }),
            sourceKey,
            checks: [],
            credit: type === "WRONG" ? 0 : (rule?.credit ?? 0),
            qcCredit: type === "WRONG" ? 0 : (ruleAt(catalog, job.projectId, catalog.qcProcessId, day)?.credit ?? 0)
          };
          const win = staffWin(worker);
          fbTask.start = advance(reassignAt, tail.int(10, 60), win);
          fbTask.done = advance(fbTask.start, qty * mpi * (worker.profile?.speed ?? 1), win);
          if (mode === "REDO_PROCESSING") {
            fbTask.start = minDate(fbTask.start, plusMinutes(NOW, -tail.int(30, 240)));
            fbTask.done = advance(NOW, tail.int(60, 300), win);
          }
          let check = advance(fbTask.done, tail.int(10, 120), qcWin(fbTask.qcId!));
          if (mode === "REDO_WAITING_QC") {
            if (fbTask.done > NOW) {
              // Finished a little before now (never before it was assigned).
              const latest = NOW.getTime() - 10 * 60_000;
              const target = Math.max(reassignAt.getTime() + 25 * 60_000, NOW.getTime() - tail.int(60, 300) * 60_000);
              fbTask.done = new Date(Math.min(latest, target));
              fbTask.start = new Date(Math.max(reassignAt.getTime() + 5 * 60_000, Math.min(fbTask.start.getTime(), fbTask.done.getTime() - 20 * 60_000)));
            }
            check = advance(NOW, tail.int(30, 150), qcWin(fbTask.qcId!));
          }
          fbTask.checks.push({ at: check, pass: true });
          job.tasks.set(key, fbTask);
          keys.push(key);
        }
        ev.push({ t: "fbReassign", at: reassignAt, keys });
        keys.forEach((key) => pushTask(job.tasks.get(key)!));
        const resolveAt = new Date(Math.max(...keys.map((key) => job.tasks.get(key)!.checks.at(-1)!.at.getTime())));
        const again = advance(resolveAt, tail.int(15, 120), accountWin);
        ev.push({ t: "fbResolve", at: resolveAt }, { t: "delivering", at: again }, { t: "delivered", at: advance(again, tail.int(60, 1200), accountWin) });
      }
    } else {
      ev.push({ t: "delivered", at: advance(job.deliveringAt, tail.chance(0.6) ? tail.int(90, 900) : tail.int(600, 1800), accountWin) });
    }

    if (archiveOld.has(job.index)) {
      const lastAt = Math.max(...ev.map((item) => item.at.getTime()));
      job.archivedAt = maxDate(vn("2026-07-14", "10:00"), new Date(lastAt + 3_600_000));
      job.archivedAt = plusMinutes(job.archivedAt, job.index % 30);
      ev.push({ t: "archive", at: job.archivedAt });
    }
    if (cancelCandidate && job.index === cancelCandidate.index) {
      job.cancelled = true;
      job.archivedAt = advance(job.splitAt, tail.int(120, 360), accountWin);
      ev.push(
        { t: "comment", at: plusMinutes(job.archivedAt, -6), authorId: job.accountId, taskKey: null, body: "Khách báo huỷ đơn do đổi kế hoạch ra mắt sản phẩm. Em lưu trữ job, mọi người dừng xử lý nhé.", mentions: [job.leaderId] },
        { t: "archive", at: job.archivedAt }
      );
    }

    // Comments: busier in the last ten days.
    const recent = job.createdAt.getTime() > NOW.getTime() - 10 * 86_400_000;
    if (tail.chance(recent ? 0.45 : 0.1)) {
      const first = job.tasks.get(job.normalKeys[0]!)!;
      const firstWorker = personById.get(first.assigneeId)!;
      const comments: Ev[] = [];
      if (tail.chance(0.6)) {
        comments.push({
          t: "comment",
          at: plusMinutes(job.createdAt, tail.int(3, 25)),
          authorId: job.accountId,
          taskKey: null,
          body: tail.pick([
            "Khách nhắc giữ đúng deadline, nếu có nguy cơ trễ báo em trước 15h để em xin lùi.",
            "Khách gửi thêm file hướng dẫn màu trong thư mục /guide.",
            "Đã báo giá và khách xác nhận, mọi người triển khai nhé.",
            "Khách cần gấp 30 ảnh đầu để lên sàn sáng mai."
          ]),
          mentions: []
        });
      }
      if (first.start && tail.chance(0.7)) {
        const done = Math.round(first.qty * tail.float(0.4, 0.8));
        comments.push({
          t: "comment",
          at: new Date((first.start.getTime() + (first.done ?? first.start).getTime()) / 2),
          authorId: first.assigneeId,
          taskKey: first.key,
          body: tail.pick([
            `Em xong ${done}/${first.qty} tấm rồi, chiều nay xong nốt ạ.`,
            "Ảnh 12–15 bị cháy sáng, em cứu được khoảng 90% thôi ạ.",
            "File gốc thiếu 2 ảnh, em đã báo account.",
            "Em đang làm theo file REF, anh/chị xem giúp ảnh đầu đã đúng tông chưa ạ?"
          ]),
          mentions: []
        });
        if (tail.chance(0.5)) {
          comments.push({
            t: "comment",
            at: plusMinutes(new Date((first.start.getTime() + (first.done ?? first.start).getTime()) / 2), tail.int(8, 50)),
            authorId: job.leaderId,
            taskKey: first.key,
            body: `@${firstWorker.name} ${tail.pick(["ok em, giữ tông như ảnh đầu nhé.", "làm kỹ phần viền tóc giúp anh.", "nếu thiếu ảnh RAW báo account ngay nhé."])}`,
            mentions: [firstWorker.id]
          });
        }
      }
      if (recent && tail.chance(0.35)) {
        const account = personById.get(job.accountId)!;
        comments.push({
          t: "comment",
          at: plusMinutes(job.splitAt, tail.int(20, 240)),
          authorId: job.leaderId,
          taskKey: null,
          body: `@${account.name} ${tail.pick([
            "nhờ em hỏi khách xác nhận lại tông màu nền giúp anh.",
            "khách có gửi file REF cho bộ này không em? Team chưa thấy trong thư mục.",
            "batch đầu xong rồi, em gửi khách duyệt mẫu trước giúp anh nhé.",
            "khách có đồng ý lùi deadline nửa ngày không em? Bộ này ảnh khó."
          ])}`,
          mentions: [account.id]
        });
      }
      if (superadmin && recent && (job.vip || job.feedback || job.rush) && tail.chance(0.6)) {
        const author = job.feedback ? job.accountId : tail.chance(0.5) ? job.accountId : job.leaderId;
        const at = job.feedback ? plusMinutes(job.feedback.at, tail.int(4, 30)) : plusMinutes(job.createdAt, tail.int(10, 60));
        comments.push({
          t: "comment",
          at,
          authorId: author,
          taskKey: null,
          body: job.feedback
            ? `@${superadmin.name} khách vừa phản hồi về job này, em đã ghi feedback, nhờ anh/chị nắm thông tin.`
            : job.rush
              ? `@${superadmin.name} job gấp, có thể phải tăng ca tối nay, nhờ anh/chị duyệt OT giúp.`
              : `@${superadmin.name} job mới của khách VIP, nhờ anh/chị theo dõi giúp em.`,
          mentions: [superadmin.id]
        });
      }
      ev.push(...comments);
    }

    // New jobs of the last days: the Account flags some of them to the superadmin (admin follows big / new work).
    if (superadmin && job.createdAt >= INBOX_FROM && tail.chance(0.3)) {
      const client = clientSpecs[job.clientIndex % clientSpecs.length]!;
      ev.push({
        t: "comment",
        at: plusMinutes(job.createdAt, tail.int(2, 15)),
        authorId: job.accountId,
        taskKey: null,
        body: `@${superadmin.name} job mới của ${client.brand}: ${job.totalImages} tấm, deadline ${hhmm(job.deadline)} ${ddmm(businessDay(job.deadline))}. Em đã chuyển Leader chia task.`,
        mentions: [superadmin.id]
      });
    }

    // Order, then cut at "now" (and at the archive of a cancelled job).
    const cutoff = job.cancelled && job.archivedAt ? job.archivedAt.getTime() : NOW.getTime();
    job.events = ev
      .map((item, order) => ({ item, order }))
      .filter(({ item }) => item.at.getTime() <= Math.min(cutoff, NOW.getTime()) || (item.t === "archive" && item.at <= NOW))
      .sort((a, b) => a.item.at.getTime() - b.item.at.getTime() || a.order - b.order)
      .map(({ item }) => item);
  }
  return jobs;
};

// Execution ------------------------------------------------------------------------------------------------

type Runtime = {
  sql: ReturnType<typeof getSql>;
  catalog: Catalog;
  people: Map<string, Person>;
  contexts: Map<string, AccessContext>;
  tagIds: Map<string, string>;
  status: (code: SystemStatusCode) => WorkflowStatus;
};

const contextOf = async (runtime: Runtime, userId: string) => {
  let context = runtime.contexts.get(userId);
  if (!context) {
    context = await resolveAccessContext(userId);
    runtime.contexts.set(userId, context);
  }
  return context;
};

const dropOutbox = (tx: QuerySql) => tx`DELETE FROM public.outbox_events WHERE created_at = now() AND aggregate_type LIKE 'production%' AND published_at IS NULL`;

/** Runs one planned job's events (up to now) through the engine inside one transaction. */
const executeJob = async (runtime: Runtime, job: JobPlan): Promise<string> => {
  const { catalog, status } = runtime;
  const organizationId = catalog.organizationId;
  const leaderContext = await contextOf(runtime, job.leaderId);
  return await runtime.sql.begin(async (tx) => {
    const definitions = await loadFieldDefinitions(tx, organizationId, "JOB");
    const customValues = validateCustomValues(definitions, job.customValues, { enforceRequired: true });
    const jobId = (
      await tx<{ id: string }[]>`
        INSERT INTO production.jobs (organization_id, project_id, code, name, leader_id, deadline, total_images, drive_link, custom_values, created_by, created_at, updated_at)
        VALUES (${organizationId}, ${job.projectId}, ${job.code}, ${job.name}, ${job.leaderId}, ${job.deadline}, ${job.totalImages}, ${job.driveLink},
          ${tx.json(customValues as never)}, ${job.accountId}, ${job.createdAt}, ${job.createdAt})
        RETURNING id
      `
    )[0]!.id;
    const jobTags = job.tagNames.flatMap((name) => (runtime.tagIds.has(name) ? [runtime.tagIds.get(name)!] : []));
    if (jobTags.length > 0) {
      await setEntityTags(tx, organizationId, "JOB", jobId, jobTags);
      await tx`UPDATE production.entity_tags SET created_at = ${job.createdAt} WHERE organization_id = ${organizationId} AND entity = 'JOB' AND entity_id = ${jobId}`;
    }
    const jobForTasks = {
      id: jobId,
      leader_id: job.leaderId,
      deadline: job.deadline,
      total_images: job.totalImages,
      qc_buffer_hours: catalog.projects.find((project) => project.id === job.projectId)!.qcBuffer
    };
    const rows = new Map<string, TaskRow>();
    const ids = new Map<string, string>();
    let feedbackId: string | null = null;

    const lineOf = (task: TaskPlan) => ({
      assigneeId: task.assigneeId,
      qcId: task.qcId,
      processId: task.processId,
      shiftId: task.shiftId,
      qtyAssigned: task.qty,
      ...(task.deadline ? { deadline: task.deadline.toISOString() } : {}),
      ...(task.note ? { note: task.note } : {}),
      ...(task.customValues ? { customValues: task.customValues } : {}),
      ...(task.tagNames ? { tagIds: task.tagNames.flatMap((name) => (runtime.tagIds.has(name) ? [runtime.tagIds.get(name)!] : [])) } : {})
    });
    const insertBatch = async (keys: string[], kind: TaskKind, at: Date, defaultParentId: string | null) => {
      const created = await insertTasks(tx, leaderContext, catalog.workflow, jobForTasks, keys.map((key) => lineOf(job.tasks.get(key)!)), {
        kind,
        feedbackId,
        defaultParentId,
        assignedAt: at
      });
      const loaded = await selectTasks(tx, organizationId, created.ids);
      keys.forEach((key, index) => {
        ids.set(key, created.ids[index]!);
        rows.set(key, loaded[index]!);
      });
    };
    const move = async (key: string, code: SystemStatusCode, actor: string | null, note: string | null, at: Date, extras: { qtyDone?: number; otHours?: number } = {}) => {
      const row = rows.get(key);
      if (!row) return;
      rows.set(key, await moveTask(tx, organizationId, catalog.workflow, row, status(code), actor, note, { ...extras, at }));
    };
    const jobMove = async (fromCodes: SystemStatusCode[], to: SystemStatusCode, actor: string | null, note: string | null, at: Date) => {
      const fromIds = fromCodes.map((code) => status(code).id);
      const taskIds = (
        await tx<{ id: string }[]>`
          SELECT id FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ${jobId} AND status_id = ANY(${fromIds}::uuid[]) ORDER BY created_at
        `
      ).map((row) => row.id);
      if (taskIds.length === 0) return;
      const moved = await moveTasks(tx, organizationId, catalog.workflow, await selectTasks(tx, organizationId, taskIds), status(to), actor, note, { at });
      for (const row of moved) {
        for (const [key, id] of ids) {
          if (id === row.id) rows.set(key, row);
        }
      }
    };
    const release = async (actor: string | null, note: string, at: Date) => {
      const checked = catalog.workflow.statuses.filter((item) => item.countsChecked).map((item) => item.id);
      const taskIds = (
        await tx<{ id: string }[]>`
          SELECT id FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ${jobId}
            AND (status_id = ${status("FEEDBACK").id} OR (feedback_id IS NOT NULL AND status_id = ANY(${checked}::uuid[])))
          ORDER BY created_at
        `
      ).map((row) => row.id);
      const moved = await moveTasks(tx, organizationId, catalog.workflow, await selectTasks(tx, organizationId, taskIds), status("COMPLETE"), actor, note, { at });
      for (const row of moved) {
        for (const [key, id] of ids) {
          if (id === row.id) rows.set(key, row);
        }
      }
    };

    for (const ev of job.events) {
      switch (ev.t) {
        case "split":
          await insertBatch(ev.keys, "NORMAL", ev.at, null);
          break;
        case "start": {
          const task = job.tasks.get(ev.key)!;
          if (rows.get(ev.key)?.status_code !== "ASSIGNED") break;
          await move(ev.key, "PROCESSING", task.assigneeId, null, ev.at);
          break;
        }
        case "done": {
          const task = job.tasks.get(ev.key)!;
          const row = rows.get(ev.key);
          if (row?.status_code !== "PROCESSING") break;
          await move(ev.key, "DONE", task.assigneeId, null, ev.at, { qtyDone: task.qtyDone, ...(row.requires_ot_hours ? { otHours: task.otHours ?? 0.5 } : {}) });
          if (rows.get(ev.key)?.qc_id) {
            await move(ev.key, "WAITING_QC", null, "Tự động chuyển sang chờ QC.", new Date(ev.at.getTime() + 1000));
          }
          break;
        }
        case "qcAssign": {
          const task = job.tasks.get(ev.key)!;
          const row = rows.get(ev.key);
          if (!row || !task.qcAssign) break;
          await tx`UPDATE production.tasks SET qc_id = ${task.qcAssign.qcId}, updated_at = ${ev.at} WHERE organization_id = ${organizationId} AND id = ${row.id}`;
          await insertTaskLogs(tx, organizationId, [
            {
              taskId: row.id,
              jobId,
              userId: job.leaderId,
              action: "ASSIGN",
              from: { assigneeId: row.assignee_id, qcId: null },
              to: { assigneeId: row.assignee_id, qcId: task.qcAssign.qcId },
              at: ev.at
            }
          ]);
          rows.set(ev.key, { ...row, qc_id: task.qcAssign.qcId });
          if (row.status_code === "DONE") {
            await move(ev.key, "WAITING_QC", null, "Tự động chuyển sang chờ QC.", new Date(ev.at.getTime() + 1000));
          }
          break;
        }
        case "check": {
          const task = job.tasks.get(ev.key)!;
          const check = task.checks[ev.index]!;
          const qcId = task.qcAssign?.qcId ?? task.qcId;
          if (rows.get(ev.key)?.status_code !== "WAITING_QC") break;
          await move(ev.key, check.pass ? "CHECKED" : "PROCESSING", qcId, check.pass ? null : (check.note ?? null), ev.at);
          break;
        }
        case "redone": {
          const task = job.tasks.get(ev.key)!;
          if (rows.get(ev.key)?.status_code !== "PROCESSING") break;
          await move(ev.key, "DONE", task.assigneeId, null, ev.at);
          await move(ev.key, "WAITING_QC", null, "Tự động chuyển sang chờ QC.", new Date(ev.at.getTime() + 1000));
          break;
        }
        case "qty": {
          const task = job.tasks.get(ev.key)!;
          const row = rows.get(ev.key);
          if (!row || row.done_at === null || row.qty_done === null || !task.qtyFix || task.qtyFix.qty === row.qty_done) break;
          await tx`UPDATE production.tasks SET qty_done = ${task.qtyFix.qty}, updated_at = ${ev.at} WHERE organization_id = ${organizationId} AND id = ${row.id}`;
          await insertTaskLogs(tx, organizationId, [
            {
              taskId: row.id,
              jobId,
              userId: job.leaderId,
              action: "QTY",
              from: { qtyDone: row.qty_done },
              to: { qtyDone: task.qtyFix.qty, notifyAssignee: true },
              note: task.qtyFix.note,
              at: ev.at
            }
          ]);
          await onTaskQtyChanged(tx, { organizationId, taskId: row.id, previousQty: row.qty_done, nextQty: task.qtyFix.qty, at: ev.at });
          rows.set(ev.key, { ...row, qty_done: task.qtyFix.qty });
          break;
        }
        case "complete":
          await jobMove(["CHECKED"], "COMPLETE", job.leaderId, null, ev.at);
          break;
        case "delivering":
          await jobMove(["COMPLETE"], "DELIVERING", job.accountId, null, ev.at);
          break;
        case "delivered":
          await jobMove(["DELIVERING"], "DELIVERED", job.accountId, null, ev.at);
          break;
        case "feedback": {
          const deliveringIds = (
            await tx<{ id: string }[]>`
              SELECT id FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ${jobId} AND status_id = ${status("DELIVERING").id} ORDER BY created_at
            `
          ).map((row) => row.id);
          if (deliveringIds.length === 0) break;
          feedbackId = (
            await tx<{ id: string }[]>`
              INSERT INTO production.feedbacks (organization_id, job_id, source_task_id, type, note, created_by, created_at)
              VALUES (${organizationId}, ${jobId}, ${ids.get(ev.sourceKey) ?? null}, ${ev.type}, ${ev.note}, ${job.accountId}, ${ev.at})
              RETURNING id
            `
          )[0]!.id;
          await jobMove(["DELIVERING"], "FEEDBACK", job.accountId, `Feedback ${ev.type === "WRONG" ? "sai" : "yêu cầu thêm"}: ${ev.note}`.slice(0, 5000), ev.at);
          break;
        }
        case "fbReassign": {
          if (!feedbackId) break;
          const kind: TaskKind = job.feedback?.type === "WRONG" ? "FB_WRONG" : "FB_EXTRA";
          await insertBatch(ev.keys, kind, ev.at, ids.get(job.feedback!.sourceKey) ?? null);
          await tx`UPDATE production.feedbacks SET status = 'IN_PROGRESS' WHERE organization_id = ${organizationId} AND id = ${feedbackId} AND status = 'OPEN'`;
          break;
        }
        case "fbResolve": {
          if (!feedbackId) break;
          const open = await tx`
            SELECT 1 FROM production.tasks WHERE organization_id = ${organizationId} AND feedback_id = ${feedbackId} AND checked_at IS NULL
          `;
          if (open.length > 0) break;
          await tx`
            UPDATE production.feedbacks SET status = 'RESOLVED', resolution = 'REWORKED', resolved_at = ${ev.at}
            WHERE organization_id = ${organizationId} AND id = ${feedbackId}
          `;
          await release(null, "Feedback đã xử lý xong — trở về Complete.", ev.at);
          break;
        }
        case "fbClose": {
          if (!feedbackId) break;
          await tx`
            UPDATE production.feedbacks
            SET status = 'RESOLVED', resolution = 'CLOSED', resolved_at = ${ev.at}, resolved_by = ${job.accountId}, resolution_note = ${ev.note}
            WHERE organization_id = ${organizationId} AND id = ${feedbackId}
          `;
          await release(job.accountId, `Đóng feedback, không cần làm lại: ${ev.note}`.slice(0, 5000), ev.at);
          break;
        }
        case "archive":
          await tx`UPDATE production.jobs SET archived_at = ${ev.at} WHERE organization_id = ${organizationId} AND id = ${jobId}`;
          break;
        case "comment": {
          const taskId = ev.taskKey ? ids.get(ev.taskKey) : null;
          if (ev.taskKey && !taskId) break;
          await tx`
            INSERT INTO production.comments (organization_id, entity, entity_id, job_id, user_id, body, mentioned_user_ids, created_at)
            VALUES (${organizationId}, ${taskId ? "TASK" : "JOB"}, ${taskId ?? jobId}, ${jobId}, ${ev.authorId}, ${ev.body}, ${ev.mentions}::uuid[], ${ev.at})
          `;
          break;
        }
      }
    }
    await settleJob(tx, organizationId, catalog.workflow, jobId);
    // Historical replay must not flood inboxes: the engine's notification events of this transaction are dropped.
    await dropOutbox(tx);
    return jobId;
  });
};

/** May worklog jobs (all Checked): Complete the same evening, deliver, client OK the next working day. */
const advanceMayJobs = async (runtime: Runtime, leaderId: string, accountId: string) => {
  const { sql, catalog, status } = runtime;
  const organizationId = catalog.organizationId;
  const jobs = await sql<{ id: string; code: string; last_check: Date }[]>`
    SELECT j.id, j.code, max(t.checked_at) AS last_check
    FROM production.jobs j
    JOIN production.entity_tags et ON et.organization_id = j.organization_id AND et.entity = 'JOB' AND et.entity_id = j.id
    JOIN production.tags tg ON tg.organization_id = et.organization_id AND tg.id = et.tag_id AND lower(tg.name) = 'seed'
    JOIN production.tasks t ON t.organization_id = j.organization_id AND t.job_id = j.id
    WHERE j.organization_id = ${organizationId}
    GROUP BY j.id, j.code
    HAVING bool_and(t.status_id = ${status("CHECKED").id}) AND max(t.checked_at) IS NOT NULL
    ORDER BY max(t.checked_at), j.code
  `;
  const advanced: string[] = [];
  for (const job of jobs) {
    const rng = new Rng(`may:${job.code}`);
    await sql.begin(async (tx) => {
      const taskIds = (await tx<{ id: string }[]>`SELECT id FROM production.tasks WHERE organization_id = ${organizationId} AND job_id = ${job.id} ORDER BY created_at`).map(
        (row) => row.id
      );
      const completeAt = plusMinutes(job.last_check, rng.int(10, 55));
      const deliveringAt = plusMinutes(completeAt, rng.int(10, 45));
      let next = addDays(businessDay(deliveringAt), 1);
      while (!isWorkday(next)) next = addDays(next, 1);
      const deliveredAt = vn(next, `${pad2(rng.int(9, 15))}:${pad2(rng.int(0, 59))}`);
      let rows = await selectTasks(tx, organizationId, taskIds);
      rows = await moveTasks(tx, organizationId, catalog.workflow, rows, status("COMPLETE"), leaderId, null, { at: completeAt });
      rows = await moveTasks(tx, organizationId, catalog.workflow, rows, status("DELIVERING"), accountId, null, { at: deliveringAt });
      await moveTasks(tx, organizationId, catalog.workflow, rows, status("DELIVERED"), accountId, null, { at: deliveredAt });
      await settleJob(tx, organizationId, catalog.workflow, job.id);
      await dropOutbox(tx);
    });
    advanced.push(job.id);
  }
  return advanced;
};

// Statistics (dry run and summary) ------------------------------------------------------------------------------

const planStats = (plan: Plan, people: Map<string, Person>, catalog: Catalog) => {
  const byPeriod = new Map<string, Map<string, number>>();
  const add = (userId: string, at: Date, points: number) => {
    const period = periodOfDay(businessDay(at), 25);
    const map = byPeriod.get(period) ?? new Map<string, number>();
    map.set(userId, (map.get(userId) ?? 0) + points);
    byPeriod.set(period, map);
  };
  let tasks = 0;
  let lateOpen = 0;
  let lateDone = 0;
  const statusNow = new Map<string, number>();
  for (const job of plan.jobs) {
    for (const task of job.tasks.values()) {
      tasks += 1;
      const done = task.done && task.done <= NOW;
      if (done && task.payMode === "POINTS") add(task.assigneeId, task.done!, task.credit * task.qtyDone);
      const finalCheck = task.checks.at(-1);
      if (finalCheck && finalCheck.at <= NOW) add(task.qcAssign?.qcId ?? task.qcId ?? "", finalCheck.at, task.qcCredit * task.qtyDone);
      if (!done && task.effectiveDeadline < NOW && !job.cancelled && task.assignedAt <= NOW) lateOpen += 1;
      if (done && task.done! > task.effectiveDeadline) {
        lateDone += 1;
        if (process.env.SIM_DEBUG) {
          const shiftName = task.shiftId === catalog.shifts.ot ? "ot" : task.shiftId === catalog.shifts.khoan ? "khoan" : "off";
          const window = Math.round((task.effectiveDeadline.getTime() - task.assignedAt.getTime()) / 3_600_000);
          const lateBy = Math.round((task.done!.getTime() - task.effectiveDeadline.getTime()) / 3_600_000);
          console.log(`late ${task.kind} ${shiftName} window ${window}h lateBy ${lateBy}h start+${Math.round(((task.start?.getTime() ?? 0) - task.assignedAt.getTime()) / 3_600_000)}h qty ${task.qty}`);
        }
      }
      const state = !task.start || task.start > NOW ? "ASSIGNED" : !done ? "PROCESSING" : !finalCheck || finalCheck.at > NOW ? "DONE/QC" : "CHECKED+";
      if (job.createdAt.getTime() > NOW.getTime() - 7 * 86_400_000) statusNow.set(state, (statusNow.get(state) ?? 0) + 1);
    }
  }
  if (process.env.SIM_DEBUG) {
    for (const [key, minutes] of [...debugLoad].sort()) {
      const [month] = key.split("|");
      let days = 0;
      for (let day = `${month}-01`; day.startsWith(month!) && day <= TODAY; day = addDays(day, 1)) if (isWorkday(day)) days += 1;
      console.log(`load ${key}: ${Math.round(minutes / 60)} h = ${Math.round((minutes / (15 * days * 510)) * 100)} % of 15 people × ${days} days`);
    }
  }
  const weeks = (NOW.getTime() - vn(SIM_FROM, "00:00").getTime()) / (7 * 86_400_000);
  console.log(`Plan: ${plan.jobs.length} jobs (${(plan.jobs.length / weeks).toFixed(1)}/week), ${tasks} tasks, done late ${lateDone}, open & late now ${lateOpen}.`);
  console.log(`Last 7 days task states: ${[...statusNow].map(([key, value]) => `${key} ${value}`).join(", ")}`);
  console.log(`Feedback: ${plan.jobs.filter((job) => job.feedback).map((job) => job.feedback!.mode).join(", ")}`);
  const names = new Map([...people.values()].map((person) => [person.id, person.key]));
  for (const [period, map] of [...byPeriod].sort()) {
    const line = [...map]
      .filter(([userId]) => names.has(userId))
      .sort((a, b) => (names.get(a[0])! < names.get(b[0])! ? -1 : 1))
      .map(([userId, points]) => `${names.get(userId)} ${Math.round(points)}`)
      .join("  ");
    console.log(`  ${period}: ${line}`);
  }
  void catalog;
};

// Main -----------------------------------------------------------------------------------------------------------

const main = async () => {
  const sql = getSql();
  const organizationId = (await sql<{ id: string }[]>`SELECT id FROM public.organizations WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`)[0]?.id;
  if (!organizationId) {
    throw new Error("No organization found.");
  }
  const workflowBefore = await loadWorkflowModel(sql, organizationId);
  // The owner's account: --owner-email / SEED_SIM_OWNER_EMAIL, else the organization member with the superadmin role.
  const superadminId =
    (
      await sql<{ id: string }[]>`
        SELECT au.id FROM public.organization_memberships om
        JOIN public.app_users au ON au.id = om.user_id AND au.deleted_at IS NULL
        JOIN public.roles r ON r.id = om.role_id
        WHERE om.organization_id = ${organizationId} AND om.deleted_at IS NULL AND om.status = 'active'
          AND (CASE WHEN ${ownerEmail} = '' THEN r.key = 'superadmin' ELSE lower(au.email) = ${ownerEmail} END)
        ORDER BY om.created_at
        LIMIT 1
      `
    )[0]?.id ?? null;

  if (!dryRun) {
    await removePrevious(sql, organizationId, workflowBefore);
    if (resetOnly) {
      return;
    }
  }

  // People ---------------------------------------------------------------------------------------------------
  let ids: Map<string, string>;
  if (dryRun) {
    ids = new Map<string, string>();
    for (const spec of accountSpecs) {
      const id = (await sql<{ id: string }[]>`SELECT id FROM auth.users WHERE lower(email) = ${spec.email}`)[0]?.id;
      ids.set(spec.key, id ?? `00000000-0000-4000-8000-${String(hashText(spec.key)).padStart(12, "0").slice(0, 12)}`);
    }
  } else {
    ids = await ensureAccounts(sql, organizationId);
  }
  const people = new Map<string, Person>();
  for (const spec of accountSpecs) {
    people.set(spec.key, {
      key: spec.key,
      id: ids.get(spec.key)!,
      name: spec.name,
      team: spec.team,
      isQc: spec.roles.includes("QC"),
      isLeader: spec.roles.includes("LEADER"),
      ...(staffProfiles[spec.key] ? { profile: staffProfiles[spec.key]! } : {})
    });
  }
  if (superadminId) {
    const name = (await sql<{ display_name: string }[]>`SELECT display_name FROM public.app_users WHERE id = ${superadminId}`)[0]!.display_name;
    people.set("SUPER", { key: "SUPER", id: superadminId, name, team: null, isQc: false, isLeader: false });
  }

  // Catalog (read) ---------------------------------------------------------------------------------------------
  let catalog = await loadCatalog(sql, organizationId);
  const clientOrder = [...catalog.projects].sort((a, b) => hashText(`c:${a.code}`) - hashText(`c:${b.code}`));
  const clientOfProject = new Map(clientOrder.map((project, index) => [project.id, index % clientSpecs.length]));

  // Credit-rule versioning: three priced pairs get +5 % from 2026-09-01 (from the DB rates).
  const versionPairs = catalog.rules
    .filter((rule) => rule.processId !== catalog.qcProcessId && rule.money !== null && rule.from === "2026-05-01" && rule.to === null)
    .sort((a, b) => hashText(`v:${a.id}`) - hashText(`v:${b.id}`))
    .slice(0, 3);
  const bump = (rule: RuleRow) => ({
    credit: Math.round(rule.credit * 105) / 100,
    money: rule.money === null ? null : Math.round((rule.money * 1.05) / 500) * 500
  });
  if (dryRun) {
    for (const rule of versionPairs) {
      const next = bump(rule);
      catalog.rules.push({ ...rule, id: `dry-${rule.id}`, credit: next.credit, money: next.money, from: "2026-09-01" });
      rule.to = "2026-09-01";
    }
  }

  // Leave plan (needed by the work plan: nobody works on approved leave).
  const { leaves, lateLeave } = planLeaves(people);
  // The late-approved sick day counts too: the person was absent, only the approval came after the close.
  for (const leave of [...leaves, ...(lateLeave ? [lateLeave] : [])].filter((item) => item.status === "APPROVED")) {
    const days = leaveDays.get(leave.userId) ?? new Map<string, LeavePart>();
    for (let day = leave.from; day <= leave.to; day = addDays(day, 1)) {
      days.set(day, leave.part);
    }
    leaveDays.set(leave.userId, days);
  }

  if (dryRun) {
    const existingCodes = new Set((await sql<{ code: string }[]>`SELECT lower(code) AS code FROM production.jobs WHERE organization_id = ${organizationId}`).map((row) => row.code));
    const jobs = planJobs({ catalog, people, clientOfProject, existingCodes });
    planStats({ jobs, leaves, lateLeave }, people, catalog);
    console.log(`Leave: ${leaves.length} requests (${leaves.filter((item) => item.status === "PENDING").length} pending).`);
    return;
  }

  const manifest = emptyManifest();
  const admin = await resolveAccessContext(ids.get("ADMIN01")!);
  const accountContext = await resolveAccessContext(ids.get("ACC01")!);

  // Catalog extras -------------------------------------------------------------------------------------------
  const existingFields = (await listCustomFields(admin, null)).items;
  for (const [index, spec] of fieldSpecs.entries()) {
    const current = existingFields.find((field) => field.entity === spec.entity && field.key === spec.key);
    const input = UpsertCustomFieldRequestSchema.parse({
      entity: spec.entity,
      key: spec.key,
      label: spec.label,
      type: spec.type,
      options: spec.options ?? [],
      showInTable: spec.showInTable ?? false,
      sortOrder: index
    });
    const fields = (await upsertCustomField(admin, current?.id ?? null, input)).items;
    const saved = fields.find((field) => field.entity === spec.entity && field.key === spec.key)!;
    manifest.fieldIds.push(saved.id);
  }
  const tagIds = new Map<string, string>();
  for (const spec of tagSpecs) {
    const current = (await listTags(admin)).items.find((tag) => tag.name.toLowerCase() === spec.name.toLowerCase());
    const tags = (await upsertTag(admin, current?.id ?? null, UpsertTagRequestSchema.parse({ name: spec.name, color: spec.color, active: true }))).items;
    const saved = tags.find((tag) => tag.name.toLowerCase() === spec.name.toLowerCase())!;
    tagIds.set(spec.name, saved.id);
    if (!current) manifest.tagIds.push(saved.id);
  }
  const clientIds: string[] = [];
  for (const spec of clientSpecs) {
    const current = (await listClients(accountContext)).items.find((client) => client.name.toLowerCase() === spec.name.toLowerCase());
    const input = UpsertClientRequestSchema.parse({
      name: spec.name,
      note: spec.note,
      active: true,
      customValues: { kenh_nhan_anh: spec.channel, dinh_dang_xuat: spec.format, muc_uu_tien: spec.priority, nguoi_lien_he: spec.contact, sla_gio: spec.sla },
      tagIds: spec.tags.map((name) => tagIds.get(name)!)
    });
    const clients = (await upsertClient(accountContext, current?.id ?? null, input)).items;
    const saved = clients.find((client) => client.name.toLowerCase() === spec.name.toLowerCase())!;
    clientIds.push(saved.id);
    manifest.clientIds.push(saved.id);
  }
  for (const project of catalog.projects) {
    await upsertProject(
      admin,
      project.id,
      UpsertProductionProjectRequestSchema.parse({ code: project.code, name: project.name, clientId: clientIds[clientOfProject.get(project.id) ?? 0]! })
    );
  }
  await sql.begin(async (tx) => {
    for (const rule of versionPairs) {
      const next = bump(rule);
      manifest.creditRuleIds.push(
        await setCreditRule(tx, {
          organizationId,
          projectId: rule.projectId,
          processId: rule.processId,
          creditPerImage: next.credit,
          moneyPerImage: next.money,
          effectiveFrom: "2026-09-01",
          userId: ids.get("ADMIN01")!
        })
      );
    }
    await tx`UPDATE production.credit_rules SET created_at = ${vn("2026-08-28", "15:10")} WHERE organization_id = ${organizationId} AND id = ANY(${manifest.creditRuleIds}::uuid[])`;
  });
  await updateSettings(
    admin,
    UpdateProductionSettingsRequestSchema.parse({
      scoresPublic: true,
      moneyPublic: false,
      chatAttachmentsEnabled: true
    })
  );
  await saveManifest(sql, organizationId, manifest);

  // Teams, roles, member profiles ------------------------------------------------------------------------------------
  const teamIds: string[] = [];
  for (const [index, name] of teamNames.entries()) {
    const rows = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM production.teams WHERE organization_id = ${organizationId} AND lower(name) IN (${name.toLowerCase()}, ${legacyTeamNames[index]!.toLowerCase()})
      ORDER BY (lower(name) = ${name.toLowerCase()}) DESC
    `;
    if (rows[0]) {
      if (rows[0].name !== name) await upsertTeam(admin, rows[0].id, { name, active: true });
      teamIds.push(rows[0].id);
    } else {
      await upsertTeam(admin, null, { name });
      teamIds.push((await sql<{ id: string }[]>`SELECT id FROM production.teams WHERE organization_id = ${organizationId} AND lower(name) = ${name.toLowerCase()}`)[0]!.id);
    }
  }
  for (const spec of accountSpecs) {
    const profile = staffProfiles[spec.key];
    const customValues: Record<string, string | string[]> = {};
    if (profile) {
      customValues.ngay_vao_lam = profile.joined;
      customValues.cap_bac = profile.level;
      customValues.chuyen_mon = profile.skills;
      customValues.nang_luc = competenceOf(spec.key, profile.level);
    } else if (spec.key.startsWith("LEAD")) {
      customValues.ngay_vao_lam = spec.key === "LEAD01" ? "2020-09-01" : "2021-03-15";
      customValues.cap_bac = "lead";
      customValues.chuyen_mon = ["retouch", "color", "model"];
      customValues.nang_luc = competenceOf(spec.key, "lead");
    }
    const tags = [
      ...(qcStaffKeys.has(spec.key) ? ["Kiêm QC"] : []),
      ...(profile?.level === "junior" ? ["Đang đào tạo"] : [])
    ].map((name) => tagIds.get(name)!);
    if (spec.key === "ADMIN01") {
      continue;
    }
    await updateMember(
      admin,
      ids.get(spec.key)!,
      UpdateProductionMemberRequestSchema.parse({
        roles: spec.roles,
        teamId: spec.team === null ? null : teamIds[spec.team]!,
        ...(Object.keys(customValues).length > 0 ? { customValues } : {}),
        tagIds: tags
      })
    );
  }
  // Everyone else holding STAFF / LEADER (accounts of other seeds) gets a "Năng lực" too; --reset removes the key.
  const ownIds = new Set(ids.values());
  const others = await sql<{ user_id: string; email: string | null; has_value: boolean | null }[]>`
    SELECT DISTINCT ur.user_id, au.email, (mp.custom_values ? 'nang_luc') AS has_value
    FROM production.user_roles ur
    JOIN public.app_users au ON au.id = ur.user_id
    LEFT JOIN production.member_profiles mp ON mp.organization_id = ur.organization_id AND mp.user_id = ur.user_id
    WHERE ur.organization_id = ${organizationId} AND ur.role_code IN ('STAFF', 'LEADER')
  `;
  for (const other of others.filter((row) => !row.has_value && !ownIds.has(row.user_id))) {
    await updateMember(
      admin,
      other.user_id,
      UpdateProductionMemberRequestSchema.parse({ customValues: { nang_luc: competenceOf(other.email ?? other.user_id, "middle") } })
    );
  }
  await invalidateAccessContexts();
  catalog = await loadCatalog(sql, organizationId);

  const runtime: Runtime = {
    sql,
    catalog,
    people,
    contexts: new Map(),
    tagIds,
    status: (code) => statusByCode(catalog.workflow, code)
  };

  // Leave -------------------------------------------------------------------------------------------------------
  const insertLeave = async (leave: LeavePlan) =>
    (
      await sql<{ id: string }[]>`
        INSERT INTO production.leave_requests (organization_id, user_id, from_date, to_date, part, note, status, decided_by, decided_at, decision_note,
          cancelled_by, cancelled_at, created_at, updated_at)
        VALUES (${organizationId}, ${leave.userId}, ${leave.from}::date, ${leave.to}::date, ${leave.part}, ${leave.note}, ${leave.status},
          ${leave.decidedBy}, ${leave.decidedAt}, ${leave.decisionNote}, ${leave.cancelledAt ? leave.userId : null}, ${leave.cancelledAt},
          ${leave.createdAt}, ${leave.cancelledAt ?? leave.decidedAt ?? leave.createdAt})
        RETURNING id
      `
    )[0]!.id;
  for (const leave of leaves) {
    manifest.leaveIds.push(await insertLeave(leave));
  }
  await saveManifest(sql, organizationId, manifest);

  // Work ----------------------------------------------------------------------------------------------------------
  const existingCodes = new Set((await sql<{ code: string }[]>`SELECT lower(code) AS code FROM production.jobs WHERE organization_id = ${organizationId}`).map((row) => row.code));
  const jobs = planJobs({ catalog, people, clientOfProject, existingCodes });
  planStats({ jobs, leaves, lateLeave }, people, catalog);

  manifest.mayJobIds = await advanceMayJobs(runtime, ids.get("LEAD01")!, ids.get("ACC01")!);
  console.log(`May worklog jobs delivered: ${manifest.mayJobIds.length}.`);
  await saveManifest(sql, organizationId, manifest);

  const jobIdByIndex = new Map<number, string>();
  const started = Date.now();
  for (const job of jobs) {
    const jobId = await executeJob(runtime, job);
    jobIdByIndex.set(job.index, jobId);
    manifest.jobIds.push(jobId);
    if (job.index % 50 === 49) {
      await saveManifest(sql, organizationId, manifest);
      console.log(`  … ${job.index + 1}/${jobs.length} jobs (${Math.round((Date.now() - started) / 1000)} s)`);
    }
  }
  await saveManifest(sql, organizationId, manifest);

  // Post-processing: realistic updated_at, open late tasks flagged like the lateness scan would have.
  const allJobIds = [...manifest.jobIds, ...manifest.mayJobIds];
  await sql`
    UPDATE production.tasks t SET updated_at = l.at
    FROM (SELECT task_id, max(created_at) AS at FROM production.task_logs WHERE organization_id = ${organizationId} AND job_id = ANY(${allJobIds}::uuid[]) GROUP BY task_id) l
    WHERE t.organization_id = ${organizationId} AND t.id = l.task_id
  `;
  await sql`
    UPDATE production.jobs j SET updated_at = greatest(j.created_at, coalesce(j.archived_at, j.created_at),
      coalesce((SELECT max(t.updated_at) FROM production.tasks t WHERE t.organization_id = j.organization_id AND t.job_id = j.id), j.created_at))
    WHERE j.organization_id = ${organizationId} AND j.id = ANY(${allJobIds}::uuid[])
  `;
  const settings0 = await sql<{ value: unknown }[]>`SELECT value FROM production.settings WHERE organization_id = ${organizationId} AND key = 'due_soon_hours'`;
  const dueSoonHours = typeof settings0[0]?.value === "number" ? settings0[0].value : 2;
  await sql`
    UPDATE production.tasks t SET is_late = true, late_notified_deadline = t.deadline
    FROM production.jobs j
    WHERE j.organization_id = t.organization_id AND j.id = t.job_id AND j.archived_at IS NULL AND t.organization_id = ${organizationId}
      AND t.job_id = ANY(${manifest.jobIds}::uuid[]) AND t.done_at IS NULL AND t.closed_at IS NULL AND t.deadline < now()
  `;
  await sql`
    UPDATE production.tasks t SET due_soon_notified_deadline = t.deadline
    WHERE t.organization_id = ${organizationId} AND t.job_id = ANY(${manifest.jobIds}::uuid[]) AND t.done_at IS NULL AND t.closed_at IS NULL
      AND t.deadline > now() AND t.deadline <= now() + make_interval(hours => ${dueSoonHours})
  `;

  // KPI targets, settlements ---------------------------------------------------------------------------------------
  await seedKpi(runtime, manifest, people, lateLeave, insertLeave);
  await saveManifest(sql, organizationId, manifest);

  // Saved reports, anomaly reviews, job chats, inbox ---------------------------------------------------------------
  await seedReports(runtime, manifest, people, teamIds);
  await seedAnomalyReviews(runtime, manifest, people);
  await saveManifest(sql, organizationId, manifest);
  await seedJobChats(runtime, manifest, people, jobs, jobIdByIndex);
  await saveManifest(sql, organizationId, manifest);
  await seedInbox(runtime, manifest, people, dueSoonHours);
  await saveManifest(sql, organizationId, manifest);
  await printSummary(runtime, manifest, people);
};

// KPI ---------------------------------------------------------------------------------------------------------------

const seedKpi = async (
  runtime: Runtime,
  manifest: Manifest,
  people: Map<string, Person>,
  lateLeave: LeavePlan | null,
  insertLeave: (leave: LeavePlan) => Promise<string>
) => {
  const { sql, catalog } = runtime;
  const organizationId = catalog.organizationId;
  const closeDay = 25;
  const lastClosed = latestClosedPeriod(NOW, closeDay);
  // Calibrate the targets with the organization's own proration setting (spec default: off).
  const prorateRow = await sql<{ value: unknown }[]>`SELECT value FROM production.settings WHERE organization_id = ${organizationId} AND key = 'kpi_prorate_leave'`;
  const prorateLeave = prorateRow[0]?.value === true;
  const calibrate: string[] = [];
  for (let period = "2026-06"; period <= lastClosed; period = shiftPeriod(period, 1)) {
    calibrate.push(period);
  }
  const staff = [...people.values()].filter((person) => person.profile);
  const leaders = [people.get("LEAD01")!, people.get("LEAD02")!];
  const everyone = [...staff, ...leaders];
  const figures = new Map<string, { points: number; leave: number; working: number }>();
  for (const period of calibrate) {
    const { from, to } = periodRange(period, closeDay);
    const rows = await sql<{ user_id: string; points: string }[]>`
      SELECT user_id, coalesce(sum(credits) FILTER (WHERE pay_mode = 'POINTS'), 0)::text AS points
      FROM production.score_entries WHERE organization_id = ${organizationId} AND business_day BETWEEN ${from}::date AND ${to}::date
      GROUP BY user_id
    `;
    const leave = await approvedLeaveDaysByUser(sql, organizationId, everyone.map((person) => person.id), from, to, { workdaysOnly: true });
    const points = new Map(rows.map((row) => [row.user_id, Number(row.points)]));
    for (const person of everyone) {
      figures.set(`${person.id}|${period}`, { points: points.get(person.id) ?? 0, leave: leave.get(person.id) ?? 0, working: countWorkingDays(from, to) });
    }
  }
  const multiplier: Record<string, number> = { NV03: 0.85, NV08: 0.85, NV12: 0.9, NV09: 1.1, NV01: 1.05 };
  const versionFactor = (period: string) => (period >= "2026-10" ? 1.083 : period >= "2026-09" ? 1.03 : 1);
  const round10 = (value: number) => Math.round(value / 10) * 10;
  const metRate = (group: Person[], base: number, mult: (person: Person) => number, factor: (period: string) => number) => {
    let met = 0;
    let total = 0;
    for (const person of group) {
      for (const period of calibrate) {
        const figure = figures.get(`${person.id}|${period}`)!;
        const result = settleUser({
          targetBase: round10(base * mult(person) * factor(period)),
          prorateLeave,
          workingDays: figure.working,
          leaveDays: figure.leave,
          pointsOfficial: figure.points,
          khoanCredits: 0,
          khoanMoneyRaw: 0,
          // No Khoán figures here: "met" does not depend on the policy (PD-033).
          khoanPolicy: "ALWAYS"
        });
        met += result.met ? 1 : 0;
        total += 1;
      }
    }
    return total === 0 ? 0 : met / total;
  };
  const search = (group: Person[], goal: number, mult: (person: Person) => number, factor: (period: string) => number) => {
    let best = 2000;
    let bestGap = Number.POSITIVE_INFINITY;
    for (let base = 800; base <= 8000; base += 10) {
      const gap = Math.abs(metRate(group, base, mult, factor) - goal);
      if (gap < bestGap - 1e-9) {
        best = base;
        bestGap = gap;
      }
    }
    return best;
  };
  const staffBase = search(staff, 0.65, (person) => multiplier[person.key] ?? 1, versionFactor);
  const leaderFactor = (period: string) => (period >= "2026-09" ? 1.1 : 1);
  const leaderBase = search(leaders, 0.5, () => 1, leaderFactor);
  console.log(
    `KPI: member base ${staffBase} (met ${Math.round(metRate(staff, staffBase, (person) => multiplier[person.key] ?? 1, versionFactor) * 100)} % in ${calibrate.join(", ")}), ` +
      `leader base ${leaderBase}.`
  );

  const admin = await contextOf(runtime, people.get("ADMIN01")!.id);
  type Item = { userId: string; periodType: "MONTH" | "QUARTER" | "YEAR"; effectiveFrom: string; targetPoints: number; note?: string };
  const items: Item[] = [];
  const created = new Map<string, Date>();
  const versionNotes: Record<string, string> = {
    "2026-06": "KPI Q3 áp dụng từ kỳ 06",
    "2026-09": "Điều chỉnh KPI từ kỳ 09 (+3%)",
    "2026-10": "KPI Q4 theo kế hoạch năm",
    "2026-12": "Tăng tốc cuối năm"
  };
  for (const person of staff) {
    const mult = multiplier[person.key] ?? 1;
    for (const period of ["2026-06", "2026-09", "2026-10"]) {
      items.push({
        userId: person.id,
        periodType: "MONTH",
        effectiveFrom: period,
        targetPoints: round10(staffBase * mult * versionFactor(period)),
        note: mult < 1 && period === "2026-06" ? `${versionNotes[period]} — nhân viên mới, ${Math.round(mult * 100)}% KPI` : versionNotes[period]!
      });
    }
  }
  for (const key of ["NV01", "NV07", "NV14"]) {
    const person = people.get(key)!;
    items.push({ userId: person.id, periodType: "MONTH", effectiveFrom: "2026-12", targetPoints: round10(staffBase * (multiplier[key] ?? 1) * 1.12), note: versionNotes["2026-12"]! });
  }
  for (const person of leaders) {
    items.push(
      { userId: person.id, periodType: "MONTH", effectiveFrom: "2026-06", targetPoints: round10(leaderBase), note: "KPI Leader (điểm QC + task tự làm)" },
      { userId: person.id, periodType: "MONTH", effectiveFrom: "2026-09", targetPoints: round10(leaderBase * 1.1), note: "KPI Leader từ kỳ 09" }
    );
  }
  const nv09 = people.get("NV09")!;
  const nv01 = people.get("NV01")!;
  items.push(
    { userId: nv09.id, periodType: "QUARTER", effectiveFrom: "2026-07", targetPoints: round10(staffBase * 1.1 * 3 * 1.02), note: "Mục tiêu quý cho QC chính" },
    { userId: nv01.id, periodType: "YEAR", effectiveFrom: "2026-01", targetPoints: round10(staffBase * 1.05 * 10), note: "Mục tiêu năm 2026 (từ tháng 3)" }
  );
  const result = await putKpiTargets(admin, PutKpiTargetsRequestSchema.parse({ items }));
  const createdAt: Record<string, Date> = {
    "MONTH|2026-06": vn("2026-05-28", "10:15"),
    "MONTH|2026-09": vn("2026-08-27", "15:40"),
    "MONTH|2026-10": vn("2026-09-24", "16:30"),
    "MONTH|2026-12": vn(addDays(TODAY, -2), "11:05"),
    "QUARTER|2026-07": vn("2026-06-30", "09:30"),
    "YEAR|2026-01": vn("2026-06-02", "14:00")
  };
  for (const target of result.items) {
    manifest.kpiTargetIds.push(target.id);
    const at = createdAt[`${target.periodType}|${target.effectiveFrom}`] ?? NOW;
    created.set(target.id, at);
  }
  await sql.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    for (const [id, at] of created) {
      await tx`UPDATE production.kpi_targets SET created_at = ${at}, updated_at = ${at} WHERE organization_id = ${organizationId} AND id = ${id}`;
    }
  });
  // The KPI defaults (settings kpi_default_member / kpi_default_leader) keep the spec values 2600 / 1848 (PLAN §10).

  // Automatic settlement at each close day 23:59 (the cron), oldest first.
  for (let period = "2026-05"; period <= lastClosed; period = shiftPeriod(period, 1)) {
    const closeAt = periodCloseInstant(period, closeDay);
    const runId = await sql.begin(async (tx) => {
      const settled = await settleMonth(tx, organizationId, period, { trigger: "AUTO", runBy: null, reason: null });
      await tx`DELETE FROM public.outbox_events WHERE created_at = now() AND published_at IS NULL AND aggregate_type = 'production_kpi_run'`;
      return settled.runId;
    });
    await sql`UPDATE production.kpi_settlement_runs SET started_at = ${closeAt}, finished_at = ${new Date(closeAt.getTime() + 1800)} WHERE organization_id = ${organizationId} AND id = ${runId}`;
    await sql`UPDATE production.kpi_settlements SET run_at = ${new Date(closeAt.getTime() + 1800)} WHERE organization_id = ${organizationId} AND run_id = ${runId}`;
    manifest.runIds.push(runId);
  }
  // A sick day approved after the close → the Admin re-runs the last closed period with a reason.
  if (lateLeave) {
    manifest.leaveIds.push(await insertLeave(lateLeave));
    const rerunAt = vn(rerunDayOf(), "10:05");
    const name = [...people.values()].find((person) => person.id === lateLeave.userId)?.name ?? "";
    const runId = await sql.begin(async (tx) => {
      const settled = await settleMonth(tx, organizationId, lastClosed, {
        trigger: "MANUAL",
        runBy: people.get("ADMIN01")!.id,
        reason: `Chạy lại kỳ ${lastClosed.slice(5)}/${lastClosed.slice(0, 4)}: bổ sung ngày nghỉ ốm ${ddmm(lateLeave.from)} của ${name} được duyệt sau ngày chốt.`
      });
      await tx`DELETE FROM public.outbox_events WHERE created_at = now() AND published_at IS NULL AND aggregate_type = 'production_kpi_run'`;
      return settled.runId;
    });
    await sql`UPDATE production.kpi_settlement_runs SET started_at = ${rerunAt}, finished_at = ${new Date(rerunAt.getTime() + 2100)} WHERE organization_id = ${organizationId} AND id = ${runId}`;
    await sql`UPDATE production.kpi_settlements SET run_at = ${new Date(rerunAt.getTime() + 2100)} WHERE organization_id = ${organizationId} AND run_id = ${runId}`;
    manifest.runIds.push(runId);
  }
};

// Saved reports & anomalies ---------------------------------------------------------------------------------------

const seedReports = async (runtime: Runtime, manifest: Manifest, people: Map<string, Person>, teamIds: string[]) => {
  const { sql, catalog } = runtime;
  const organizationId = catalog.organizationId;
  const superadmin = people.get("SUPER");
  const owner = (key: string) => people.get(key) ?? people.get("ADMIN01")!;
  const specs: { owner: string; name: string; description: string; config: Record<string, unknown>; shared: boolean; pinned?: boolean; pinOrder?: number; at: Date }[] = [
    {
      owner: superadmin ? "SUPER" : "ADMIN01",
      name: "Điểm theo team từng tuần",
      description: "Tổng điểm chính thức của mỗi team theo tuần, 30 ngày gần nhất.",
      config: { dimensions: ["week", "team"], measures: ["points"], preset: "LAST_30_DAYS", view: { type: "BAR", rows: ["week"], columns: ["team"] } },
      shared: true,
      pinned: true,
      pinOrder: 1,
      at: vn("2026-07-06", "09:20")
    },
    {
      owner: superadmin ? "SUPER" : "ADMIN01",
      name: "Số tấm theo khách hàng tháng này",
      description: "Số tấm đã xong và số task theo client trong tháng hiện tại.",
      config: { dimensions: ["client"], measures: ["qty_done", "task_count"], preset: "THIS_MONTH", sort: { key: "qty_done", direction: "desc" }, view: { type: "BAR", rows: ["client"], columns: [] } },
      shared: true,
      pinned: true,
      pinOrder: 2,
      at: vn("2026-07-06", "09:35")
    },
    {
      owner: "ADMIN01",
      name: "Năng suất theo ca",
      description: "Số tấm, tấm/người/ngày và giờ OT theo ca trong kỳ KPI hiện tại.",
      config: { dimensions: ["shift"], measures: ["qty_done", "task_count", "qty_per_worker_day", "ot_hours"], preset: "THIS_PERIOD", view: { type: "TABLE", rows: [], columns: [] } },
      shared: true,
      at: vn("2026-08-03", "14:10")
    },
    {
      owner: "LEAD01",
      name: "Tỉ lệ QC trả lại theo nhân viên",
      description: "Kỳ KPI trước: số task, số lần QC trả lại và tỉ lệ theo người làm.",
      config: { dimensions: ["user"], measures: ["task_count", "qc_fail_count", "qc_fail_rate"], preset: "LAST_PERIOD", sort: { key: "qc_fail_rate", direction: "desc" } },
      shared: true,
      at: vn("2026-08-26", "16:45")
    },
    {
      owner: "LEAD02",
      name: "Task trễ theo dự án (30 ngày)",
      description: "Theo dõi dự án hay bị trễ để xin thêm buffer QC.",
      config: { dimensions: ["project"], measures: ["task_count", "late_count", "late_rate"], preset: "LAST_30_DAYS", sort: { key: "late_count", direction: "desc" } },
      shared: false,
      at: vn("2026-09-08", "08:50")
    },
    {
      owner: "LEAD01",
      name: "Điểm Team Ánh Sáng theo ngày",
      description: "Điểm từng ngày trong kỳ của team mình.",
      config: { dimensions: ["day"], measures: ["points"], preset: "THIS_PERIOD", filters: { team: [teamIds[0]!] }, view: { type: "LINE", rows: ["day"], columns: [] } },
      shared: false,
      at: vn("2026-09-29", "08:40")
    },
    {
      owner: "ADMIN01",
      name: "FB sai theo khách hàng Q3",
      description: "Tỉ lệ task FB sai theo client, kỳ 06–09.",
      config: { dimensions: ["client"], measures: ["task_count", "fb_wrong_count", "fb_rate"], from: "2026-05-26", to: "2026-09-25", sort: { key: "fb_rate", direction: "desc" } },
      shared: true,
      at: vn("2026-09-28", "10:00")
    },
    {
      owner: superadmin ? "SUPER" : "ADMIN01",
      name: "Tiền khoán theo nhân viên kỳ trước",
      description: "Chỉ Admin xem: điểm và tiền Khoán tạm tính của kỳ trước.",
      config: { dimensions: ["user"], measures: ["points_khoan", "money_khoan"], preset: "LAST_PERIOD", sort: { key: "money_khoan", direction: "desc" } },
      shared: false,
      at: vn("2026-09-26", "09:15")
    }
  ];
  for (const spec of specs) {
    const context = await contextOf(runtime, owner(spec.owner).id);
    const report = await createSavedReport(
      context,
      CreateSavedReportRequestSchema.parse({
        name: spec.name,
        description: spec.description,
        config: spec.config,
        shared: spec.shared,
        pinned: spec.pinned ?? false,
        ...(spec.pinOrder !== undefined ? { pinOrder: spec.pinOrder } : {})
      })
    );
    manifest.savedReportIds.push(report.id);
    await sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`UPDATE production.saved_reports SET created_at = ${spec.at}, updated_at = ${plusMinutes(spec.at, 25)} WHERE organization_id = ${organizationId} AND id = ${report.id}`;
    });
  }
};

const seedAnomalyReviews = async (runtime: Runtime, manifest: Manifest, people: Map<string, Person>) => {
  const { sql, catalog } = runtime;
  const organizationId = catalog.organizationId;
  const rng = new Rng("anomalies");
  const reviewerFallback = people.get("SUPER") ?? people.get("ADMIN01")!;
  const admin = await contextOf(runtime, reviewerFallback.id);
  const list = await listAnomalies(admin, { days: 30, includeReviewed: true });
  const leaderOfTask = new Map(
    (
      await sql<{ id: string; leader_id: string }[]>`
        SELECT t.id, j.leader_id FROM production.tasks t JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
        WHERE t.organization_id = ${organizationId} AND t.id = ANY(${list.items.flatMap((item) => (item.task ? [item.task.id] : []))}::uuid[])
      `
    ).map((row) => [row.id, row.leader_id])
  );
  let reviewed = 0;
  for (const item of list.items) {
    if (item.reviewed || item.kind === "MISSING_CREDIT_RULE") continue;
    const share = item.kind === "QTY_MISMATCH" ? 0.4 : item.kind === "FAST_DONE" ? 0.5 : 0.35;
    if (!rng.chance(share)) continue;
    const leaderId = item.task ? leaderOfTask.get(item.task.id) : undefined;
    const reviewer = leaderId && rng.chance(0.7) ? leaderId : reviewerFallback.id;
    const context = await contextOf(runtime, reviewer);
    await reviewAnomaly(context, { kind: item.kind, key: item.key, note: rng.pick(reviewNotes[item.kind]) });
    const at = maxDate(new Date(Date.parse(item.at) + rng.int(30, 2880) * 60_000));
    await sql`
      UPDATE production.anomaly_reviews SET reviewed_at = ${minDate(at, plusMinutes(NOW, -rng.int(20, 240)))}
      WHERE organization_id = ${organizationId} AND kind = ${item.kind} AND subject_key = ${item.key}
    `;
    manifest.reviewKeys.push({ kind: item.kind, key: item.key });
    reviewed += 1;
  }
  console.log(`Anomalies (30 days): ${list.items.length} listed, ${reviewed} marked "Đã xem".`);
};

// Job chats ---------------------------------------------------------------------------------------------------------

const doc = (parts: ({ text: string } | { mention: string; label: string })[]) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: parts.map((part) => ("text" in part ? { type: "text", text: part.text } : { type: "mention", attrs: { id: part.mention, label: part.label } }))
    }
  ]
});

const sendWithRetry = async (context: AccessContext, channelId: string, body: ReturnType<typeof doc>) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await sendMessage(context, channelId, SendMessageRequestSchema.parse({ body, clientMessageId: randomUUID(), attachmentIds: [] }));
    } catch (error) {
      if (attempt < 3 && error instanceof AppError && error.code === "CHAT_RATE_LIMITED") {
        await new Promise((resolve) => setTimeout(resolve, 11_000));
        continue;
      }
      throw error;
    }
  }
};

const seedJobChats = async (runtime: Runtime, manifest: Manifest, people: Map<string, Person>, jobs: JobPlan[], jobIdByIndex: Map<number, string>) => {
  const { sql, catalog } = runtime;
  const organizationId = catalog.organizationId;
  const rng = new Rng("chat");
  const superadmin = people.get("SUPER");
  const byId = new Map([...people.values()].map((person) => [person.id, person]));
  const phaseStart = new Date();
  const candidates = jobs.filter(
    (job) =>
      !job.archivedAt &&
      job.createdAt.getTime() > NOW.getTime() - 6 * 86_400_000 &&
      job.createdAt.getTime() < NOW.getTime() - 4 * 3_600_000 &&
      job.events.some((ev) => ev.t === "split")
  );
  const chosen = [
    ...candidates.filter((job) => job.feedback),
    ...rng.shuffle(candidates.filter((job) => !job.feedback && job.normalKeys.length >= 2))
  ].slice(0, 10);
  const timeline: { channelId: string; openAt: Date; joinAt: Date | null; messages: { id: string; at: Date; authorId: string; mentions: string[] }[] }[] = [];

  for (const [position, job] of chosen.entries()) {
    const jobId = jobIdByIndex.get(job.index)!;
    const leaderContext = await contextOf(runtime, job.leaderId);
    const openAt = plusMinutes(job.splitAt, rng.int(5, 30));
    const { channelId } = await openJobChat(leaderContext, jobId);
    manifest.channelIds.push(channelId);
    const withSuper = superadmin && position % 2 === 0;
    const joinAt = withSuper ? plusMinutes(openAt, rng.int(20, 180)) : null;
    if (withSuper) {
      await openJobChat(await contextOf(runtime, superadmin.id), jobId);
    }
    const workers = [...new Set(job.normalKeys.map((key) => job.tasks.get(key)!.assigneeId))];
    const qcs = [...new Set(job.normalKeys.flatMap((key) => {
      const task = job.tasks.get(key)!;
      const qc = task.qcAssign?.qcId ?? task.qcId;
      return qc ? [qc] : [];
    }))];
    const first = job.tasks.get(job.normalKeys[0]!)!;
    const firstWorker = byId.get(first.assigneeId)!;
    const secondWorker = byId.get(workers[1] ?? workers[0]!)!;
    const client = clientSpecs[job.clientIndex % clientSpecs.length]!;
    const process = catalog.processes.get(first.processId)?.name ?? "retouch";
    type Line = { authorId: string; parts: ({ text: string } | { mention: string; label: string })[]; afterFeedback?: boolean };
    const script: Line[] = [
      { authorId: job.leaderId, parts: [{ text: `Mọi người lưu ý: khách ${client.brand} yêu cầu ${client.requirement}. Vướng gì báo trong nhóm nhé.` }] },
      { authorId: firstWorker.id, parts: [{ text: `Dạ em nhận ${first.qty} tấm ${process}, dự kiến ${first.done && first.done <= NOW && businessDay(first.done) === businessDay(job.splitAt) ? "xong trong hôm nay" : "mai xong"} ạ.` }] },
      { authorId: job.accountId, parts: [{ text: `Khách nhắn giữ nguyên deadline ${hhmm(job.deadline)} ${ddmm(businessDay(job.deadline))}, nhờ team ưu tiên giúp em.` }] }
    ];
    if (qcs[0]) {
      script.push({ authorId: qcs[0], parts: [{ text: "Mình check batch đầu rồi, còn vài ảnh viền tóc chưa sạch, mọi người để ý nhé." }] });
    }
    if (secondWorker.id !== firstWorker.id) {
      script.push({ authorId: secondWorker.id, parts: [{ text: "Ảnh 14–18 bị thiếu file RAW, chị account hỏi lại khách giúp em với ạ." }] });
      script.push({ authorId: job.accountId, parts: [{ text: "Đã xin lại khách, link mới trong thư mục /bo-sung nhé." }] });
    }
    if (job.feedback && job.feedback.at < NOW) {
      script.push({ authorId: job.accountId, parts: [{ text: "Khách vừa gửi feedback, em đã ghi trên job, mọi người xem chi tiết trong tab Feedback nhé." }], afterFeedback: true });
    }
    if (withSuper && superadmin) {
      const feedbackLine = Boolean(job.feedback && job.feedback.at < NOW);
      script.push({
        authorId: job.leaderId,
        parts: [
          { mention: superadmin.id, label: superadmin.name },
          { text: feedbackLine ? " khách vừa gửi feedback cho job này, em sẽ giao lại cho bạn làm và báo anh/chị khi xong ạ." : " job này khách VIP, có thể cần tăng ca tối nay, anh/chị duyệt giúp em nhé." }
        ],
        afterFeedback: feedbackLine
      });
    }
    const start = (joinAt ?? openAt).getTime();
    // Work talk happens before the deadline; feedback talk after the feedback arrived.
    const workEnd = Math.min(NOW.getTime() - 15 * 60_000, Math.max(start + 3 * 3_600_000, job.deadline.getTime()));
    const messages: { id: string; at: Date; authorId: string; mentions: string[] }[] = [];
    // Only members can post (a QC chosen after "now" is not in the chat yet): their lines go to the leader.
    const members = new Set(
      (await sql<{ user_id: string }[]>`SELECT user_id FROM public.channel_members WHERE channel_id = ${channelId} AND deleted_at IS NULL`).map((row) => row.user_id)
    );
    for (const line of script) {
      if (!members.has(line.authorId)) {
        line.authorId = job.leaderId;
      }
    }
    const officeHours = windowsFor(null, "account");
    const workLines = script.filter((line) => !line.afterFeedback);
    const feedbackLines = script.filter((line) => line.afterFeedback);
    const span = workingMinutesIn(new Date(start), new Date(workEnd), officeHours);
    const latest = new Date(NOW.getTime() - 5 * 60_000);
    const planned: { line: Line; at: Date }[] = [
      ...workLines.map((line, index) => ({ line, at: minDate(advance(new Date(start), (span * (index + 1)) / (workLines.length + 1) + rng.int(-8, 8), officeHours), latest) })),
      ...feedbackLines.map((line, index) => ({ line, at: minDate(advance(job.feedback!.at, 10 + index * rng.int(15, 60), officeHours), latest) }))
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    for (const { line, at } of planned) {
      const context = await contextOf(runtime, line.authorId);
      const sent = await sendWithRetry(context, channelId, doc(line.parts));
      messages.push({ id: sent.message.id, at, authorId: line.authorId, mentions: line.parts.flatMap((part) => ("mention" in part ? [part.mention] : [])) });
    }
    timeline.push({ channelId, openAt, joinAt, messages });
  }

  // Back-date the chats (channel, system messages, messages, membership and read markers).
  for (const chat of timeline) {
    const sorted = [...chat.messages].sort((a, b) => a.at.getTime() - b.at.getTime());
    await sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      const lastAt = sorted.at(-1)?.at ?? chat.openAt;
      await tx`UPDATE public.channels SET created_at = ${chat.openAt}, updated_at = ${lastAt}, last_message_at = ${lastAt} WHERE id = ${chat.channelId}`;
      const systems = await tx<{ id: string; seq: string }[]>`
        SELECT id, seq::text FROM public.messages WHERE channel_id = ${chat.channelId} AND kind = 'system' ORDER BY seq
      `;
      for (const [index, message] of systems.entries()) {
        const at = index < 2 || !chat.joinAt ? plusMinutes(chat.openAt, index * 0.05) : chat.joinAt;
        await tx`UPDATE public.messages SET created_at = ${at}, updated_at = ${at} WHERE id = ${message.id}`;
      }
      for (const message of sorted) {
        await tx`UPDATE public.messages SET created_at = ${message.at}, updated_at = ${message.at} WHERE id = ${message.id}`;
        await tx`UPDATE public.message_mentions SET created_at = ${message.at} WHERE message_id = ${message.id}`;
      }
      const seqs = new Map(
        (await tx<{ id: string; seq: string }[]>`SELECT id, seq::text FROM public.messages WHERE channel_id = ${chat.channelId} AND seq IS NOT NULL`).map((row) => [
          row.id,
          Number(row.seq)
        ])
      );
      const members = await tx<{ id: string; user_id: string }[]>`
        SELECT id, user_id FROM public.channel_members WHERE channel_id = ${chat.channelId} AND deleted_at IS NULL
      `;
      for (const member of members) {
        const joined = member.user_id === superadmin?.id && chat.joinAt ? chat.joinAt : chat.openAt;
        const readUntil = member.user_id === superadmin?.id ? NOW.getTime() - 30 * 3_600_000 : NOW.getTime() - rng.int(0, 40) * 3_600_000;
        let readSeq = Math.max(...systems.map((row) => Number(row.seq)));
        for (const message of sorted) {
          if (message.at.getTime() <= readUntil || message.authorId === member.user_id) {
            readSeq = Math.max(readSeq, seqs.get(message.id) ?? 0);
          }
        }
        await tx`
          UPDATE public.channel_members SET joined_at = ${joined}, last_read_seq = ${readSeq}, last_read_at = ${new Date(Math.min(readUntil, NOW.getTime()))}
          WHERE id = ${member.id}
        `;
      }
    });
  }

  // Their notifications: wait for the worker; anything it did not pick up is suppressed and written here instead.
  const channelIds = timeline.map((chat) => chat.channelId);
  for (let waited = 0; waited < 20; waited += 1) {
    const pending = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.outbox_events
      WHERE created_at >= ${phaseStart} AND published_at IS NULL AND event_type LIKE 'chat.%' AND payload->>'channelId' = ANY(${channelIds}::text[])
    `;
    if (pending[0]!.count === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const events = await sql<{ id: string; event_type: string; actor_user_id: string | null; payload: Record<string, unknown>; published: boolean }[]>`
    UPDATE public.outbox_events SET published_at = coalesce(published_at, now())
    WHERE created_at >= ${phaseStart} AND event_type LIKE 'chat.%' AND payload->>'channelId' = ANY(${channelIds}::text[])
    RETURNING id::text, event_type, actor_user_id, payload, (published_at IS NOT NULL) AS published
  `;
  const inbox = inboxUsers(people);
  const channelNames = new Map(
    (await sql<{ id: string; name: string }[]>`SELECT id, name FROM public.channels WHERE id = ANY(${channelIds}::uuid[])`).map((row) => [row.id, row.name])
  );
  const drafts: NotificationDraft[] = [];
  for (const event of events) {
    const channelId = String(event.payload.channelId ?? "");
    const chat = timeline.find((item) => item.channelId === channelId);
    if (!chat) continue;
    if (event.event_type === "chat.channel.member_added") {
      const userIds = Array.isArray(event.payload.userIds) ? (event.payload.userIds as string[]) : [];
      const addedBy = typeof event.payload.addedBy === "string" ? event.payload.addedBy : event.actor_user_id;
      const at = superadmin && userIds.includes(superadmin.id) && chat.joinAt ? chat.joinAt : chat.openAt;
      for (const userId of userIds) {
        if (userId === addedBy) continue;
        drafts.push({
          recipientId: userId,
          type: "channel.member_added",
          actorId: addedBy,
          title: channelNames.get(channelId) ?? "Channel",
          body: null,
          channelId,
          payload: { channelKind: "private" },
          dedupe: `evt:${event.id}`,
          at: plusMinutes(at, 0.05)
        });
      }
    } else if (event.event_type === "chat.message.created") {
      const messageId = String(event.payload.messageId ?? "");
      const message = chat.messages.find((item) => item.id === messageId);
      const mentioned = Array.isArray(event.payload.mentionedUserIds) ? (event.payload.mentionedUserIds as string[]) : [];
      if (!message || mentioned.length === 0) continue;
      const text = (await sql<{ body_text: string }[]>`SELECT body_text FROM public.messages WHERE id = ${messageId}`)[0]?.body_text ?? null;
      for (const userId of mentioned) {
        drafts.push({
          recipientId: userId,
          type: "chat.mentioned",
          actorId: message.authorId,
          title: channelNames.get(channelId) ?? "Channel",
          body: text,
          channelId,
          messageId,
          payload: { channelKind: "private", threadRootId: null },
          dedupe: `evt:${event.id}:mention`,
          at: plusMinutes(message.at, 0.03)
        });
      }
    }
  }
  await writeNotifications(runtime, drafts.filter((draft) => inbox.has(draft.recipientId)), new Rng("chat-read"), { upsert: true });
  console.log(`Job chats: ${timeline.length} groups, ${timeline.reduce((sum, chat) => sum + chat.messages.length, 0)} messages.`);
};

// Inbox ---------------------------------------------------------------------------------------------------------------

type NotificationDraft = {
  recipientId: string;
  type: string;
  actorId: string | null;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  dedupe: string;
  at: Date;
  commentId?: string;
  channelId?: string;
  messageId?: string;
};

const inboxUsers = (people: Map<string, Person>) => new Set([...people.values()].map((person) => person.id));

const writeNotifications = async (runtime: Runtime, drafts: NotificationDraft[], rng: Rng, options: { upsert: boolean }) => {
  const { sql, catalog } = runtime;
  const rows = drafts
    .filter((draft) => draft.recipientId !== draft.actorId && draft.at <= NOW)
    .map((draft) => {
      const age = NOW.getTime() - draft.at.getTime();
      const read = age > 36 * 3_600_000 ? rng.chance(0.88) : rng.chance(0.22);
      const readAt = read ? minDate(plusMinutes(draft.at, rng.int(3, 360)), plusMinutes(NOW, -rng.int(5, 60))) : null;
      return {
        recipient: draft.recipientId,
        type: draft.type,
        actor: draft.actorId,
        title: draft.title.slice(0, 300),
        body: draft.body ? draft.body.slice(0, 500) : null,
        payload: draft.payload,
        dedupe: draft.dedupe.slice(0, 200),
        at: draft.at.toISOString(),
        readAt: readAt && readAt > draft.at ? readAt.toISOString() : null,
        commentId: draft.commentId ?? null,
        channelId: draft.channelId ?? null,
        messageId: draft.messageId ?? null
      };
    });
  for (let index = 0; index < rows.length; index += 500) {
    const batch = rows.slice(index, index + 500);
    await sql`
      INSERT INTO public.notifications (organization_id, recipient_user_id, type, actor_user_id, comment_id, channel_id, message_id, title, body, payload,
        dedupe_key, created_at, read_at)
      SELECT ${catalog.organizationId}, (n->>'recipient')::uuid, n->>'type', (n->>'actor')::uuid, (n->>'commentId')::uuid, (n->>'channelId')::uuid,
        (n->>'messageId')::uuid, n->>'title', n->>'body', n->'payload', n->>'dedupe', (n->>'at')::timestamptz, (n->>'readAt')::timestamptz
      FROM jsonb_array_elements(${sql.json(batch as never)}) AS n
      ${
        options.upsert
          ? sql`ON CONFLICT (organization_id, recipient_user_id, dedupe_key) DO UPDATE SET created_at = EXCLUDED.created_at, read_at = EXCLUDED.read_at`
          : sql`ON CONFLICT (organization_id, recipient_user_id, dedupe_key) DO NOTHING`
      }
    `;
  }
  return rows.length;
};

type TaskInfo = {
  id: string;
  number: string;
  job_id: string;
  job_code: string;
  leader_id: string;
  assignee_id: string;
  qc_id: string | null;
  process_name: string;
  qty_assigned: number;
  qty_done: number | null;
  deadline: Date;
  done_at: Date | null;
  assigned_at: Date;
  archived: boolean;
};

const seedInbox = async (runtime: Runtime, manifest: Manifest, people: Map<string, Person>, dueSoonHours: number) => {
  const { sql, catalog } = runtime;
  const organizationId = catalog.organizationId;
  const inbox = inboxUsers(people);
  const superadmin = people.get("SUPER");
  const drafts: NotificationDraft[] = [];
  const rng = new Rng("inbox");
  const tasks = new Map(
    (
      await sql<TaskInfo[]>`
        SELECT t.id, t.number::text, t.job_id, j.code AS job_code, j.leader_id, t.assignee_id, t.qc_id, pr.name AS process_name, t.qty_assigned, t.qty_done,
          t.deadline, t.done_at, t.assigned_at, j.archived_at IS NOT NULL AS archived
        FROM production.tasks t
        JOIN production.jobs j ON j.organization_id = t.organization_id AND j.id = t.job_id
        JOIN production.processes pr ON pr.organization_id = t.organization_id AND pr.id = t.process_id
        WHERE t.organization_id = ${organizationId} AND t.job_id = ANY(${manifest.jobIds}::uuid[])
      `
    ).map((row) => [row.id, row])
  );
  const payloadOf = (task: TaskInfo, extra: Record<string, unknown> = {}) => ({
    productionTaskId: task.id,
    jobId: task.job_id,
    jobCode: task.job_code,
    taskNumber: Number(task.number),
    processName: task.process_name,
    qty: task.qty_done ?? task.qty_assigned,
    deadline: task.deadline.toISOString(),
    ...extra
  });
  const line = (task: TaskInfo) => `#${Number(task.number)} · ${task.process_name} · ${task.qty_done ?? task.qty_assigned} tấm`;

  // Task history of the window → assigned / waiting QC / QC fail / checked / qty corrected.
  const logs = await sql<{ id: string; task_id: string; user_id: string | null; action: string; to_value: Record<string, unknown> | null; from_value: Record<string, unknown> | null; note: string | null; created_at: Date }[]>`
    SELECT id, task_id, user_id, action, to_value, from_value, note, created_at FROM production.task_logs
    WHERE organization_id = ${organizationId} AND job_id = ANY(${manifest.jobIds}::uuid[]) AND created_at >= ${INBOX_FROM} AND created_at <= ${NOW}
    ORDER BY created_at
  `;
  const firstChecked = new Set<string>();
  const earlierChecked = new Set(
    (
      await sql<{ task_id: string }[]>`
        SELECT DISTINCT task_id FROM production.task_logs
        WHERE organization_id = ${organizationId} AND job_id = ANY(${manifest.jobIds}::uuid[]) AND created_at < ${INBOX_FROM} AND action = 'STATUS' AND to_value->>'code' = 'CHECKED'
      `
    ).map((row) => row.task_id)
  );
  for (const log of logs) {
    const task = tasks.get(log.task_id);
    if (!task || task.archived) continue;
    const at = plusMinutes(log.created_at, rng.float(0.02, 0.4));
    const code = typeof log.to_value?.code === "string" ? log.to_value.code : null;
    if (log.action === "CREATE") {
      drafts.push({ recipientId: task.assignee_id, type: "production.task_assigned", actorId: log.user_id, title: task.job_code, body: line(task), payload: payloadOf(task), dedupe: `sim:${log.id}:assigned`, at });
    } else if (log.action === "STATUS" && code === "WAITING_QC" && task.qc_id) {
      drafts.push({ recipientId: task.qc_id, type: "production.task_waiting_qc", actorId: log.user_id, title: task.job_code, body: line(task), payload: payloadOf(task), dedupe: `sim:${log.id}:waiting_qc`, at });
    } else if (log.action === "STATUS" && log.to_value?.qcFail === true) {
      drafts.push({
        recipientId: task.assignee_id,
        type: "production.qc_failed",
        actorId: log.user_id,
        title: task.job_code,
        body: log.note,
        payload: payloadOf(task, { note: log.note }),
        dedupe: `sim:${log.id}:qc_failed`,
        at
      });
    } else if (log.action === "STATUS" && code === "CHECKED" && !earlierChecked.has(task.id) && !firstChecked.has(task.id)) {
      firstChecked.add(task.id);
      drafts.push({ recipientId: task.leader_id, type: "production.task_checked", actorId: log.user_id, title: task.job_code, body: line(task), payload: payloadOf(task), dedupe: `sim:${log.id}:checked`, at });
    } else if (log.action === "QTY") {
      const from = Number(log.from_value?.qtyDone);
      const to = Number(log.to_value?.qtyDone);
      drafts.push({
        recipientId: task.assignee_id,
        type: "production.qty_changed",
        actorId: log.user_id,
        title: task.job_code,
        body: `#${Number(task.number)}: ${from} → ${to} tấm${log.note ? ` — ${log.note}` : ""}`,
        payload: payloadOf(task, { from, to, note: log.note }),
        dedupe: `sim:${log.id}:qty`,
        at
      });
    }
  }

  // Deadline warnings: due soon (dueSoonHours before) and late (shortly after the deadline), as the 15-minute scan does.
  for (const task of tasks.values()) {
    if (task.archived) continue;
    const reminder = new Date(task.deadline.getTime() - dueSoonHours * 3_600_000);
    if (reminder >= INBOX_FROM && reminder <= NOW && task.assigned_at < reminder && (!task.done_at || task.done_at > reminder)) {
      const at = plusMinutes(reminder, rng.float(0.5, 14));
      for (const recipient of [task.assignee_id, task.leader_id]) {
        drafts.push({
          recipientId: recipient,
          type: "production.task_due_soon",
          actorId: null,
          title: task.job_code,
          body: `#${Number(task.number)} · ${task.process_name} · ${task.qty_assigned} tấm`,
          payload: payloadOf(task),
          dedupe: `production.task_due_soon:${task.id}:${task.deadline.toISOString()}`,
          at
        });
      }
    }
    if (task.deadline >= INBOX_FROM && task.deadline <= NOW && task.assigned_at < task.deadline && (!task.done_at || task.done_at > task.deadline)) {
      const at = plusMinutes(task.deadline, rng.float(0.5, 14));
      // Superadmin: seeded copy of the open late tasks (the real scan notifies only the worker and the job leader).
      const recipients = [task.assignee_id, task.leader_id, ...(superadmin ? [superadmin.id] : [])];
      for (const recipient of recipients) {
        drafts.push({
          recipientId: recipient,
          type: "production.task_late",
          actorId: null,
          title: task.job_code,
          body: `#${Number(task.number)} · ${task.process_name} · ${task.qty_assigned} tấm`,
          payload: payloadOf(task),
          dedupe: `production.task_late:${task.id}:${task.deadline.toISOString()}`,
          at
        });
      }
    }
  }

  // Client feedback → job leader + "NV cũ" (+ a seeded copy for the superadmin).
  const feedbacks = await sql<{ id: string; job_id: string; job_code: string; leader_id: string; type: string; note: string; created_by: string; created_at: Date; workers: string[] | null }[]>`
    SELECT f.id, f.job_id, j.code AS job_code, j.leader_id, f.type, f.note, f.created_by, f.created_at,
      CASE WHEN f.source_task_id IS NOT NULL THEN ARRAY(SELECT t.assignee_id FROM production.tasks t WHERE t.id = f.source_task_id)
        ELSE ARRAY(SELECT DISTINCT t.assignee_id FROM production.tasks t WHERE t.job_id = f.job_id AND t.kind = 'NORMAL') END AS workers
    FROM production.feedbacks f JOIN production.jobs j ON j.organization_id = f.organization_id AND j.id = f.job_id
    WHERE f.organization_id = ${organizationId} AND f.job_id = ANY(${manifest.jobIds}::uuid[]) AND f.created_at >= ${INBOX_FROM}
  `;
  for (const feedback of feedbacks) {
    for (const recipient of new Set([feedback.leader_id, ...(feedback.workers ?? []), ...(superadmin ? [superadmin.id] : [])])) {
      drafts.push({
        recipientId: recipient,
        type: "production.feedback",
        actorId: feedback.created_by,
        title: feedback.job_code,
        body: feedback.note,
        payload: { jobId: feedback.job_id, jobCode: feedback.job_code, feedbackType: feedback.type, note: feedback.note },
        dedupe: `sim:${feedback.id}:feedback`,
        at: plusMinutes(feedback.created_at, rng.float(0.05, 0.5))
      });
    }
  }

  // Comments → mentioned people ("nhắc đến") and the related ones ("bình luận").
  const comments = await sql<{ id: string; entity: string; entity_id: string; job_id: string; job_code: string; leader_id: string; created_by: string; user_id: string; body: string; mentioned_user_ids: string[]; created_at: Date }[]>`
    SELECT c.id, c.entity, c.entity_id, c.job_id, j.code AS job_code, j.leader_id, j.created_by, c.user_id, c.body, c.mentioned_user_ids, c.created_at
    FROM production.comments c JOIN production.jobs j ON j.organization_id = c.organization_id AND j.id = c.job_id
    WHERE c.organization_id = ${organizationId} AND c.job_id = ANY(${manifest.jobIds}::uuid[]) AND c.created_at >= ${INBOX_FROM} AND c.deleted_at IS NULL
  `;
  for (const comment of comments) {
    const task = comment.entity === "TASK" ? tasks.get(comment.entity_id) : undefined;
    const payload = task ? payloadOf(task, { commentId: comment.id }) : { jobId: comment.job_id, jobCode: comment.job_code, commentId: comment.id };
    const related = (task ? [task.assignee_id, task.qc_id, comment.leader_id] : [comment.leader_id, comment.created_by]).filter(
      (id): id is string => Boolean(id) && !comment.mentioned_user_ids.includes(id!)
    );
    const at = plusMinutes(comment.created_at, rng.float(0.02, 0.3));
    for (const [type, recipients] of [
      ["production.mentioned", comment.mentioned_user_ids],
      ["production.commented", related]
    ] as const) {
      for (const recipient of new Set(recipients)) {
        drafts.push({ recipientId: recipient, type, actorId: comment.user_id, title: comment.job_code, body: comment.body.slice(0, 300), payload, dedupe: `sim:${comment.id}:${type}`, at, commentId: comment.id });
      }
    }
  }

  // Leave: new requests → team leader + production admins; decisions → the requester.
  const leaveRows = await sql<{ id: string; user_id: string; display_name: string; from_date: string; to_date: string; part: string; status: string; decision_note: string | null; decided_by: string | null; decided_at: Date | null; created_at: Date; team_id: string | null }[]>`
    SELECT lr.id, lr.user_id, au.display_name, to_char(lr.from_date, 'YYYY-MM-DD') AS from_date, to_char(lr.to_date, 'YYYY-MM-DD') AS to_date, lr.part, lr.status,
      lr.decision_note, lr.decided_by, lr.decided_at, lr.created_at, mp.team_id
    FROM production.leave_requests lr
    JOIN public.app_users au ON au.id = lr.user_id
    LEFT JOIN production.member_profiles mp ON mp.organization_id = lr.organization_id AND mp.user_id = lr.user_id
    WHERE lr.organization_id = ${organizationId} AND lr.id = ANY(${manifest.leaveIds}::uuid[])
      AND (lr.created_at >= ${INBOX_FROM} OR lr.decided_at >= ${INBOX_FROM})
  `;
  const roles = await sql<{ user_id: string; role_code: string; team_id: string | null }[]>`
    SELECT ur.user_id, ur.role_code, mp.team_id FROM production.user_roles ur
    LEFT JOIN production.member_profiles mp ON mp.organization_id = ur.organization_id AND mp.user_id = ur.user_id
    WHERE ur.organization_id = ${organizationId} AND ur.role_code IN ('ADMIN', 'LEADER')
  `;
  for (const leave of leaveRows) {
    const payload = { leaveId: leave.id, requesterName: leave.display_name, fromDate: leave.from_date, toDate: leave.to_date, part: leave.part, status: leave.status, note: leave.decision_note };
    if (leave.created_at >= INBOX_FROM) {
      const recipients = roles
        .filter((row) => row.role_code === "ADMIN" || (row.role_code === "LEADER" && (leave.team_id === null || row.team_id === leave.team_id)))
        .map((row) => row.user_id);
      if (superadmin) recipients.push(superadmin.id);
      for (const recipient of new Set(recipients)) {
        drafts.push({
          recipientId: recipient,
          type: "production.leave_requested",
          actorId: leave.user_id,
          title: leave.display_name,
          body: leave.from_date === leave.to_date ? leave.from_date : `${leave.from_date} → ${leave.to_date}`,
          payload,
          dedupe: `sim:${leave.id}:requested`,
          at: plusMinutes(leave.created_at, rng.float(0.05, 0.5))
        });
      }
    }
    if (leave.decided_at && leave.decided_at >= INBOX_FROM && (leave.status === "APPROVED" || leave.status === "REJECTED")) {
      drafts.push({
        recipientId: leave.user_id,
        type: "production.leave_decided",
        actorId: leave.decided_by,
        title: leave.status === "APPROVED" ? "Đơn nghỉ được duyệt" : "Đơn nghỉ bị từ chối",
        body: leave.decision_note,
        payload,
        dedupe: `sim:${leave.id}:decided`,
        at: plusMinutes(leave.decided_at, rng.float(0.05, 0.5))
      });
    }
  }

  // KPI settlement runs of the window (the Admin's re-run): each settled person + a summary for production admins.
  const runs = await sql<{ id: string; period: string; user_count: number; met_count: number; not_met_count: number; finished_at: Date }[]>`
    SELECT id, to_char(period_month, 'YYYY-MM') AS period, user_count, met_count, not_met_count, finished_at FROM production.kpi_settlement_runs
    WHERE organization_id = ${organizationId} AND id = ANY(${manifest.runIds}::uuid[]) AND finished_at >= ${INBOX_FROM}
  `;
  const fmt = (value: number) => value.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  for (const run of runs) {
    const label = `${run.period.slice(5, 7)}/${run.period.slice(0, 4)}`;
    const settled = await sql<{ user_id: string; met: boolean; target_points: string | null; points_official: string; khoan_points_converted: string; khoan_money: string; total_points: string }[]>`
      SELECT user_id, met, target_points::text, points_official::text, khoan_points_converted::text, khoan_money::text, total_points::text
      FROM production.kpi_settlements WHERE organization_id = ${organizationId} AND run_id = ${run.id}
    `;
    const at = plusMinutes(run.finished_at, rng.float(0.05, 0.3));
    for (const row of settled) {
      const target = row.target_points === null ? null : Number(row.target_points);
      const total = Number(row.total_points);
      drafts.push({
        recipientId: row.user_id,
        type: "production.kpi_settled",
        actorId: null,
        title: `Chốt KPI kỳ ${label}`,
        body: `${row.met ? "Đạt KPI" : "Chưa đạt KPI"}: ${fmt(total)}${target === null ? "" : ` / ${fmt(target)}`} điểm`,
        payload: {
          runId: run.id,
          period: run.period,
          points: total,
          target,
          percent: target && target > 0 ? Math.round((total / target) * 10_000) / 100 : null,
          met: row.met,
          pointsOfficial: Number(row.points_official),
          khoanPointsConverted: Number(row.khoan_points_converted),
          khoanMoney: Number(row.khoan_money)
        },
        dedupe: `kpi:${run.id}:result`,
        at
      });
    }
    for (const recipient of new Set([...roles.filter((row) => row.role_code === "ADMIN").map((row) => row.user_id), ...(superadmin ? [superadmin.id] : [])])) {
      drafts.push({
        recipientId: recipient,
        type: "production.kpi_settled",
        actorId: null,
        title: `Đã chốt KPI kỳ ${label}`,
        body: `${run.met_count}/${run.user_count} người đạt KPI`,
        payload: { runId: run.id, period: run.period, summary: true, settled: run.user_count, met: run.met_count, notMet: run.not_met_count },
        dedupe: `kpi:${run.id}:summary`,
        at
      });
    }
  }

  const written = await writeNotifications(runtime, drafts.filter((draft) => inbox.has(draft.recipientId)), rng, { upsert: false });
  // Stale production entries of the seeded accounts that point at leave / jobs that no longer exist (old test runs).
  const stale = await sql`
    DELETE FROM public.notifications n
    WHERE n.organization_id = ${organizationId} AND n.type LIKE 'production.%' AND n.recipient_user_id = ANY(${[...inbox]}::uuid[])
      AND ((n.payload ? 'leaveId' AND NOT EXISTS (SELECT 1 FROM production.leave_requests lr WHERE lr.id::text = n.payload->>'leaveId'))
        OR (n.payload ? 'jobId' AND NOT EXISTS (SELECT 1 FROM production.jobs j WHERE j.id::text = n.payload->>'jobId')))
    RETURNING n.id
  `;
  console.log(`Inbox: ${written} production notifications for the last 5 days (${stale.length} stale ones removed).`);
};

// Summary ---------------------------------------------------------------------------------------------------------

const printSummary = async (runtime: Runtime, manifest: Manifest, people: Map<string, Person>) => {
  const { sql, catalog } = runtime;
  const organizationId = catalog.organizationId;
  const counts = await sql<{ name: string; count: number }[]>`
    SELECT 'jobs' AS name, count(*)::int AS count FROM production.jobs WHERE organization_id = ${organizationId}
    UNION ALL SELECT 'jobs archived', count(*)::int FROM production.jobs WHERE organization_id = ${organizationId} AND archived_at IS NOT NULL
    UNION ALL SELECT 'tasks', count(*)::int FROM production.tasks WHERE organization_id = ${organizationId}
    UNION ALL SELECT 'task_logs', count(*)::int FROM production.task_logs WHERE organization_id = ${organizationId}
    UNION ALL SELECT 'score_entries', count(*)::int FROM production.score_entries WHERE organization_id = ${organizationId}
    UNION ALL SELECT 'score adjustments', count(*)::int FROM production.score_entries WHERE organization_id = ${organizationId} AND adjusts_entry_id IS NOT NULL
    UNION ALL SELECT 'feedbacks', count(*)::int FROM production.feedbacks WHERE organization_id = ${organizationId}
    UNION ALL SELECT 'feedbacks open', count(*)::int FROM production.feedbacks WHERE organization_id = ${organizationId} AND status <> 'RESOLVED'
    UNION ALL SELECT 'comments', count(*)::int FROM production.comments WHERE organization_id = ${organizationId}
    UNION ALL SELECT 'clients', count(*)::int FROM production.clients WHERE organization_id = ${organizationId}
    UNION ALL SELECT 'custom_fields', count(*)::int FROM production.custom_fields WHERE organization_id = ${organizationId}
    UNION ALL SELECT 'tags', count(*)::int FROM production.tags WHERE organization_id = ${organizationId}
    UNION ALL SELECT 'credit_rules', count(*)::int FROM production.credit_rules WHERE organization_id = ${organizationId}
    UNION ALL SELECT 'kpi_targets', count(*)::int FROM production.kpi_targets WHERE organization_id = ${organizationId}
    UNION ALL SELECT 'leave_requests', count(*)::int FROM production.leave_requests WHERE organization_id = ${organizationId}
    UNION ALL SELECT 'leave pending', count(*)::int FROM production.leave_requests WHERE organization_id = ${organizationId} AND status = 'PENDING'
    UNION ALL SELECT 'saved_reports', count(*)::int FROM production.saved_reports WHERE organization_id = ${organizationId}
    UNION ALL SELECT 'anomaly_reviews', count(*)::int FROM production.anomaly_reviews WHERE organization_id = ${organizationId}
    UNION ALL SELECT 'settlement runs', count(*)::int FROM production.kpi_settlement_runs WHERE organization_id = ${organizationId}
    UNION ALL SELECT 'notifications (production + job chat)', count(*)::int FROM public.notifications WHERE organization_id = ${organizationId}
      AND (type LIKE 'production.%' OR channel_id = ANY(${manifest.channelIds}::uuid[]))
    UNION ALL SELECT 'pending outbox', count(*)::int FROM public.outbox_events WHERE published_at IS NULL
  `;
  console.log("\nCounts:");
  for (const row of counts) console.log(`  ${row.name.padEnd(40)} ${row.count}`);
  const statuses = await sql<{ name: string; count: number; late: number }[]>`
    SELECT s.name, count(*)::int AS count, count(*) FILTER (WHERE t.is_late AND t.done_at IS NULL AND t.closed_at IS NULL)::int AS late
    FROM production.tasks t JOIN production.statuses s ON s.id = t.status_id JOIN production.jobs j ON j.id = t.job_id
    WHERE t.organization_id = ${organizationId} AND j.archived_at IS NULL GROUP BY s.name, s.sort_order ORDER BY s.sort_order
  `;
  console.log("Tasks by status (active jobs):");
  for (const row of statuses) console.log(`  ${row.name.padEnd(20)} ${String(row.count).padStart(5)}${row.late ? `  (late ${row.late})` : ""}`);
  const runs = await sql<{ period: string; trigger: string; user_count: number; met_count: number; khoan: string; finished: string; has_rows: boolean }[]>`
    SELECT to_char(r.period_month, 'YYYY-MM') AS period, r.trigger, r.user_count, r.met_count, r.khoan_money_total::text AS khoan,
      to_char(r.finished_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI') AS finished,
      EXISTS (SELECT 1 FROM production.kpi_settlements ks WHERE ks.run_id = r.id) AS has_rows
    FROM production.kpi_settlement_runs r WHERE r.organization_id = ${organizationId} ORDER BY r.period_month, r.finished_at
  `;
  console.log("Settlement runs:");
  for (const run of runs) {
    console.log(`  ${run.period} ${run.trigger.padEnd(6)} ${run.finished}  met ${run.met_count}/${run.user_count}  khoán ${Number(run.khoan).toLocaleString("vi-VN")} đ${run.has_rows ? "" : "  (replaced)"}`);
  }
  const unread = await sql<{ user_id: string; unread: number; total: number }[]>`
    SELECT recipient_user_id AS user_id, count(*) FILTER (WHERE read_at IS NULL)::int AS unread, count(*)::int AS total
    FROM public.notifications WHERE organization_id = ${organizationId} AND recipient_user_id = ANY(${[...people.values()].map((person) => person.id)}::uuid[])
      AND created_at >= ${INBOX_FROM}
    GROUP BY recipient_user_id
  `;
  console.log("Inbox (last 5 days, unread/total):");
  console.log(
    `  ${[...people.values()]
      .map((person) => {
        const row = unread.find((item) => item.user_id === person.id);
        return `${person.key} ${row?.unread ?? 0}/${row?.total ?? 0}`;
      })
      .join("  ")}`
  );
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
