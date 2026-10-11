/**
 * Shared types for scripts/seed-workspace.ts (LOCAL DEVELOPMENT ONLY).
 *
 * Content files (./content/*.ts) describe an INVENTED photo-retouch company's office life over
 * 2026-08-25 → 2026-10-10 (Asia/Ho_Chi_Minh). Everything is fiction: no real clients, client codes,
 * prices or staff names. People are referenced by persona key only.
 *
 * Mini-markup used by every `Text` field (converted to the app's rich-text JSON by the engine):
 *   @{key}            mention of a persona, e.g. "@{minh} xem giúp em" (label = their current display name)
 *   **bold**          bold
 *   `code`            inline code
 *   [label](https://example.com)   link (https only)
 *   blank line        new paragraph; a single newline inside a paragraph = line break
 *   "- item"          bullet list item (consecutive lines form one list)
 *   "1. item"         ordered list item
 *   "[ ] item" / "[x] item"   checklist item (unchecked / checked)
 *   "## Heading"      heading
 *   "> quote"         block quote
 */

export const productionStaff = [
  "nv01", "nv02", "nv03", "nv04", "nv05", "nv06", "nv07", "nv08",
  "nv09", "nv10", "nv11", "nv12", "nv13", "nv14", "nv15"
] as const;

/**
 * boss   the organization's superadmin account — Giám đốc / founder ("anh", "sếp"). Central participant everywhere.
 * linh   Linh Trần — Trưởng phòng vận hành ("chị Linh"). Runs most projects.
 * admin  admin01 — Hành chính–nhân sự & quản trị hệ thống (org admin). Name unknown → mention only.
 * minh   Minh Nguyễn — IT / lập trình viên nội bộ ("anh Minh").
 * an     An Phạm — Thiết kế đồ hoạ / marketing ("An").
 * khoa   Khoa Lê — Trưởng nhóm QC chất lượng ("anh Khoa").
 * lead1  lead01 — Trưởng ca sản xuất nhóm A. Name unknown → mention only.
 * lead2  lead02 — Trưởng ca sản xuất nhóm B (falls back to lead1 if the account does not exist).
 * acc1   acc01 — Account / điều phối đơn & chăm sóc khách hàng. Name unknown → mention only.
 * acc2   acc02 — Account thứ hai (falls back to acc1 if missing).
 * nv01…nv15 — retoucher (nhân viên chỉnh ảnh). Names unknown → mention only.
 * loc    Phạm Văn Lộc — retoucher, NGHỈ VIỆC từ 2026-09-12 (account disabled). Only active before that date.
 * hanh   Đỗ Thu Hạnh — thực tập sinh marketing, KẾT THÚC thực tập 2026-09-30 (disabled). Only active before.
 */
export type PersonaKey =
  | "boss" | "linh" | "admin" | "minh" | "an" | "khoa"
  | "lead1" | "lead2" | "acc1" | "acc2"
  | (typeof productionStaff)[number]
  | "loc" | "hanh";

export type Priority = "urgent" | "high" | "normal" | "low";

export type ColorToken =
  | "slate" | "gray" | "red" | "orange" | "amber" | "yellow" | "lime" | "green" | "emerald" | "teal"
  | "cyan" | "sky" | "blue" | "indigo" | "violet" | "purple" | "fuchsia" | "pink" | "rose";

export type ProjectIcon =
  | "folder" | "rocket" | "briefcase" | "code" | "palette" | "megaphone" | "target" | "users" | "book" | "bug"
  | "chart" | "globe" | "layers" | "zap" | "heart" | "star" | "shield" | "package" | "lightbulb" | "building"
  | "flag" | "compass" | "workflow" | "sparkles";

/** Mini-markup text, see header. */
export type Text = string;

/**
 * A file attached to a task, a comment or a chat message. The extension decides what the engine generates:
 * .png / .jpg (a small rendered image), .pdf, .xlsx, .docx, .csv, .txt. Keep names realistic, Vietnamese
 * without diacritics or with diacritics both fine, e.g. "bao-cao-nang-suat-tuan-38.xlsx", "Ảnh lỗi VPN.png".
 */
export type FileSpec = {
  name: string;
  /** Optional hint for the generated image/document content (e.g. "before/after sky replacement"). */
  hint?: string;
};

// Work management ------------------------------------------------------------------------------------

export type StatusSeed = { name: string; category: "active" | "done" | "closed"; color: ColorToken };

/**
 * Due-date bucket relative to "today" = Saturday 2026-10-10 (now ≈ 18:40):
 *   overdue   open task, due 1–12 days ago
 *   today     due 2026-10-10 (end of day)
 *   tomorrow  due 2026-10-11/12
 *   week      due within the next 7 days
 *   next_week due 8–14 days ahead
 *   later     due 15–60 days ahead
 *   none      no due date
 *   past      (done tasks) due date in the past around the completion date
 */
export type DueBucket = "overdue" | "today" | "tomorrow" | "week" | "next_week" | "later" | "none" | "past";

export type CommentSeed = {
  by: PersonaKey;
  text: Text;
  /** Days after the task was created (fractional ok). Engine clamps into the task's lifetime. */
  at?: number;
  /** Replies (one level only, like the app). */
  replies?: CommentSeed[];
  /** The comment was later edited to this text (shows "đã chỉnh sửa"). */
  edited?: Text;
  /** Files attached to this comment. */
  files?: FileSpec[];
};

export type SubtaskSeed = {
  title: string;
  assignees?: PersonaKey[];
  /** Status name from the list's workflow; omitted → engine decides (mostly follows the parent). */
  status?: string;
  due?: DueBucket;
  priority?: Priority;
};

export type TaskSeed = {
  title: string;
  /** Rich description (mini-markup). ~40% of tasks should have one; some with checklists, links, @mentions. */
  desc?: Text;
  priority?: Priority;
  /** Who created the task (must have access to the project). Omitted → a project manager/member. */
  creator?: PersonaKey;
  /** 0–3 people. Omitted → engine picks suitable members. Use [] for an explicitly unassigned task. */
  assignees?: PersonaKey[];
  /** FINAL status name, must exist in the list's workflow (or the project's). Omitted → engine decides. */
  status?: string;
  due?: DueBucket;
  /** Days before 2026-10-10 the task was created (0–45). Omitted → engine decides. */
  createdDaysAgo?: number;
  subtasks?: Array<string | SubtaskSeed>;
  comments?: CommentSeed[];
  /** Files attached to the task itself. */
  files?: FileSpec[];
  /** The task ends up in the trash (Thùng rác). Use for ~1–2 tasks per project. */
  trash?: boolean;
};

export type ListSeed = {
  name: string;
  description?: string;
  color?: ColorToken;
  /** List-level workflow overriding the project's (e.g. bug tracker, hiring pipeline). */
  workflow?: StatusSeed[];
  /** The list was archived (its tasks disappear from views). */
  archived?: boolean;
  tasks: TaskSeed[];
};

export type ProjectSeed = {
  /** 2–12 uppercase letters/digits, e.g. "VH". */
  key: string;
  name: string;
  description: string;
  icon: ProjectIcon;
  color: ColorToken;
  visibility: "public" | "private";
  /** Creator; becomes a "manage" member. */
  owner: PersonaKey;
  /** Explicit project members: "manage" = Quản lý, "submit" = Thành viên, "view" = Chỉ xem. */
  members: Partial<Record<PersonaKey, "view" | "submit" | "manage">>;
  /** Project-level workflow (first status must be active; at least one done). */
  workflow: StatusSeed[];
  /** YYYY-MM-DD the project was created (2026-08-25 … 2026-09-20). */
  createdOn: string;
  /** YYYY-MM-DD the project was archived (only for the archived project). */
  archivedOn?: string;
  lists: ListSeed[];
};

/** Generic comments the engine sprinkles on tasks without authored comments. `{assignee}` → mention of an assignee. */
export type CommentPool = {
  progress: Text[];
  question: Text[];
  review: Text[];
  blocker: Text[];
  done: Text[];
  managerNudge: Text[];
};

// Chat ------------------------------------------------------------------------------------------------

/**
 * Channels (names as shown in the app, without "#"):
 *   chung            public  — everyone; general office talk, questions, reminders
 *   thong-bao        public  — announcements (boss, linh, admin post; others react / reply in threads)
 *   san-xuat         public  — production floor: shifts, job deadlines, client feedback, rush orders
 *   qc-chat-luong    public  — QC notes, common mistakes, style guides
 *   marketing        public  — fanpage posts, portfolio, ads, events
 *   it-ho-tro        public  — IT helpdesk (VPN, NAS, Photoshop, máy chậm, wifi, máy in, Nesso Work)
 *   tan-gau          public  — chit-chat: ăn trưa, sinh nhật, đá bóng, cà phê, du lịch
 *   ban-dieu-hanh    private — boss, linh, admin, acc1, lead1 (management)
 *   leader-san-xuat  private — boss, linh, lead1, lead2, khoa (production leaders)
 *   team-building-thang-9  public, ARCHIVED on 2026-09-28 — organizing the September team building trip
 */
export type ChannelKey =
  | "chung" | "thong-bao" | "san-xuat" | "qc-chat-luong" | "marketing" | "it-ho-tro" | "tan-gau"
  | "ban-dieu-hanh" | "leader-san-xuat" | "team-building-thang-9";

/** Group DMs (fixed participant sets). */
export type GroupKey =
  | "g-website"       // boss, minh, an, linh — website redesign
  | "g-taichinh"      // boss, linh, admin, acc1 — chi phí, lương, hoá đơn
  | "g-khach-kho"     // acc1, acc2, lead1, khoa — escalations about demanding clients
  | "g-teambuilding"; // admin, linh, an, nv02, nv09 — team building organizers (active until ~2026-09-27)

export type ConversationRef =
  | { channel: ChannelKey }
  | { dm: [PersonaKey, PersonaKey] }
  | { group: GroupKey };

export type ChatLine = {
  by: PersonaKey;
  /** Mini-markup; may be omitted when the line only sends files. */
  text?: Text;
  files?: FileSpec[];
  /** Minutes after the previous line of the scene (or after the thread root for the first reply). Default 1–6. */
  gap?: number;
  /** Thread replies under this message. */
  thread?: ChatLine[];
  /** Emoji reactions: emoji → who reacted, e.g. { "👍": ["linh", "minh"], "🎉": ["boss"] }. */
  react?: Record<string, PersonaKey[]>;
  /** The message was later edited to this text. */
  edited?: Text;
  /** The author later deleted this message (shows as "Tin nhắn đã bị xoá"). */
  deleted?: boolean;
};

export type ChatScene = {
  where: ConversationRef;
  /** YYYY-MM-DD between 2026-08-25 and 2026-10-10 (Mon–Sat; Sundays rare). */
  date: string;
  /** HH:MM local time of the first line (mostly 08:00–18:00, some evenings). */
  time: string;
  lines: ChatLine[];
};
