import type { NotificationType } from "../../contracts/notifications.js";

/**
 * Vietnamese e-mail rendering of inbox notifications (PD-013, PLAN §8). Pure functions: one
 * template per notification type, combined into a digest e-mail. Every interpolated value is
 * HTML-escaped; links are built from APP_PUBLIC_URL with validated ids only.
 */

export const productName = "Nesso Work";
const businessTimeZone = "Asia/Ho_Chi_Minh";

export type EmailNotification = {
  type: string;
  title: string;
  body: string | null;
  actorName: string | null;
  projectId: string | null;
  taskId: string | null;
  channelId: string | null;
  messageId: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type NotificationSection = {
  /** Plain-text subject used when the digest holds a single notification. */
  subject: string;
  headline: string;
  facts: { label: string; value: string }[];
  excerpt: string | null;
  link: string;
  time: string | null;
};

export type RenderedEmail = { subject: string; text: string; html: string };

const htmlEntities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => htmlEntities[char] ?? char);

const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
const num = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: unknown) => (typeof value === "string" && uuidPattern.test(value) ? value : null);

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: businessTimeZone,
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

/** "17:00, 10/10/2026" in Asia/Ho_Chi_Minh; null for missing or invalid input. */
export const formatDateTime = (value: unknown) => {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = Object.fromEntries(dateTimeFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}, ${parts.day}/${parts.month}/${parts.year}`;
};

/** "2026-10-12" → "12/10/2026". */
const formatDay = (value: unknown) => {
  const day = text(value);
  const match = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
};

// Links ------------------------------------------------------------------------------------------

/** Web path a notification opens (relative to APP_PUBLIC_URL). */
export const notificationPath = (notification: EmailNotification) => {
  const productionTaskId = uuid(notification.payload.productionTaskId);
  if (productionTaskId) {
    return `/production/tasks/${productionTaskId}`;
  }
  const jobId = uuid(notification.payload.jobId);
  if (jobId) {
    return `/production/jobs/${jobId}`;
  }
  const projectId = uuid(notification.projectId);
  const taskId = uuid(notification.taskId);
  if (projectId && taskId) {
    return `/p/${projectId}?task=${taskId}`;
  }
  const channelId = uuid(notification.channelId);
  if (channelId) {
    const params = new URLSearchParams();
    const threadRootId = uuid(notification.payload.threadRootId);
    if (threadRootId) {
      params.set("thread", threadRootId);
    }
    const messageId = uuid(notification.messageId);
    if (messageId) {
      params.set("message", messageId);
    }
    const query = params.toString();
    return `/c/${channelId}${query ? `?${query}` : ""}`;
  }
  if (projectId) {
    return `/p/${projectId}`;
  }
  if (notification.type.startsWith("production.leave_") || uuid(notification.payload.leaveId)) {
    return "/production/leave";
  }
  return "/inbox";
};

const joinUrl = (baseUrl: string, path: string) => `${baseUrl.replace(/\/+$/, "")}${path}`;
export const notificationLink = (notification: EmailNotification, baseUrl: string) => joinUrl(baseUrl, notificationPath(notification));

// Templates --------------------------------------------------------------------------------------

type Fact = [label: string, value: string | null];
type Template = { headline: string; subject?: string; facts?: Fact[]; excerpt?: string | null };

const contextOf = (notification: EmailNotification) => {
  const payload = notification.payload;
  const jobCode = text(payload.jobCode) ?? notification.title;
  const taskNumber = num(payload.taskNumber);
  const qty = num(payload.qty);
  const kind = text(payload.channelKind);
  return {
    actor: notification.actorName?.trim() || "Ai đó",
    title: notification.title,
    excerpt: text(notification.body),
    taskKey: text(payload.taskKey) ?? "công việc",
    projectName: text(payload.projectName),
    channel: kind === "dm" || kind === "group_dm" ? "tin nhắn trực tiếp" : `#${notification.title}`,
    isDirect: kind === "dm" || kind === "group_dm",
    jobCode,
    taskRef: taskNumber !== null ? `${jobCode} #${taskNumber}` : jobCode,
    hasTask: taskNumber !== null,
    note: text(payload.note),
    productionFacts: [
      ["Job", jobCode],
      ["Task", taskNumber !== null ? `#${taskNumber}` : null],
      ["Công đoạn", text(payload.processName)],
      ["Số lượng", qty !== null ? `${qty} tấm` : null],
      ["Deadline", formatDateTime(payload.deadline)]
    ] satisfies Fact[]
  };
};

type Context = ReturnType<typeof contextOf>;
type TemplateFn = (notification: EmailNotification, context: Context) => Template;

const taskFacts = (c: Context): Fact[] => [
  ["Công việc", c.title],
  ["Dự án", c.projectName]
];

const leaveParts: Record<string, string> = { FULL_DAY: "Cả ngày", MORNING: "Buổi sáng", AFTERNOON: "Buổi chiều" };

/** "12/10/2026" or "12/10/2026 – 13/10/2026" from the leave payload's fromDate / toDate. */
const leaveSpan = (n: EmailNotification) => {
  const from = formatDay(n.payload.fromDate);
  const to = formatDay(n.payload.toDate);
  return from && to && from !== to ? `${from} – ${to}` : from;
};

const leaveFacts = (n: EmailNotification): Fact[] => {
  const part = text(n.payload.part);
  return [
    ["Thời gian", leaveSpan(n)],
    ["Buổi", part ? (leaveParts[part] ?? part) : null]
  ];
};

/** Work-task templates: the subject also names the task, e.g. "Linh đã giao cho bạn WEB-12: Thiết kế banner". */
const taskTemplate = (c: Context, headline: string, excerpt: string | null = null): Template => ({
  headline,
  subject: `${headline}: ${c.title}`,
  facts: taskFacts(c),
  excerpt
});

const templates = {
  "task.assigned": (n, c) =>
    taskTemplate(c, `${c.actor} ${n.payload.reopened === true ? "đã mở lại và giao cho bạn" : "đã giao cho bạn"} ${c.taskKey}`),
  "task.mentioned": (_n, c) => taskTemplate(c, `${c.actor} đã nhắc đến bạn trong ${c.taskKey}`, c.excerpt),
  "task.commented": (_n, c) => taskTemplate(c, `${c.actor} đã bình luận trong ${c.taskKey}`, c.excerpt),
  "task.replied": (_n, c) => taskTemplate(c, `${c.actor} đã trả lời bình luận của bạn trong ${c.taskKey}`, c.excerpt),
  "task.status_changed": (n, c) => {
    const status = text(n.payload.statusName);
    return taskTemplate(
      c,
      n.payload.isDone === true
        ? `${c.actor} đã hoàn thành ${c.taskKey}`
        : status
          ? `${c.actor} đã chuyển ${c.taskKey} sang ${status}`
          : `${c.actor} đã đổi trạng thái ${c.taskKey}`
    );
  },
  "task.due_soon": (n, c) => {
    const due = formatDateTime(n.payload.dueAt);
    return taskTemplate(c, `${c.taskKey} sắp đến hạn${due ? ` lúc ${due}` : ""}`);
  },
  "task.overdue": (n, c) => {
    const due = formatDateTime(n.payload.dueAt);
    return taskTemplate(c, `${c.taskKey} đã quá hạn${due ? ` (hạn ${due})` : ""}`);
  },
  "project.member_added": (_n, c) => ({ headline: `${c.actor} đã thêm bạn vào dự án ${c.projectName ?? c.title}` }),
  "chat.mentioned": (_n, c) => ({ headline: `${c.actor} đã nhắc đến bạn trong ${c.channel}`, excerpt: c.excerpt }),
  "chat.thread_replied": (_n, c) => ({
    headline: `${c.actor} đã trả lời chuỗi tin nhắn bạn tham gia trong ${c.channel}`,
    excerpt: c.excerpt
  }),
  "channel.member_added": (_n, c) => ({
    headline: c.isDirect ? `${c.actor} đã bắt đầu cuộc trò chuyện với bạn` : `${c.actor} đã thêm bạn vào kênh #${c.title}`
  }),

  // Production (PLAN §8) ------------------------------------------------------------------------
  "production.task_assigned": (_n, c) => ({ headline: `Bạn được giao task ${c.taskRef}`, facts: c.productionFacts }),
  "production.task_waiting_qc": (_n, c) => ({ headline: `Task ${c.taskRef} đang chờ bạn QC`, facts: c.productionFacts }),
  "production.qc_failed": (_n, c) => ({
    headline: `Task ${c.taskRef} không đạt QC`,
    facts: c.productionFacts,
    excerpt: c.note ?? c.excerpt
  }),
  "production.task_checked": (_n, c) => ({ headline: `Task ${c.taskRef} đã qua QC (Checked)`, facts: c.productionFacts }),
  "production.task_due_soon": (n, c) => {
    const deadline = formatDateTime(n.payload.deadline);
    return { headline: `Task ${c.taskRef} sắp đến hạn${deadline ? ` (${deadline})` : ""}`, facts: c.productionFacts };
  },
  "production.task_late": (n, c) => {
    const deadline = formatDateTime(n.payload.deadline);
    return { headline: `Task ${c.taskRef} đã trễ deadline${deadline ? ` (${deadline})` : ""}`, facts: c.productionFacts };
  },
  "production.qty_changed": (n, c) => {
    const from = num(n.payload.from);
    const to = num(n.payload.to);
    return {
      headline: `${c.actor} đã sửa số lượng task ${c.taskRef}${from !== null && to !== null ? `: ${from} → ${to} tấm` : ""}`,
      facts: c.productionFacts,
      excerpt: c.note
    };
  },
  "production.feedback": (n, c) => ({
    headline: `Có feedback từ khách hàng cho job ${c.jobCode}`,
    facts: [
      ["Job", c.jobCode],
      ["Loại feedback", text(n.payload.feedbackType)]
    ],
    excerpt: c.note ?? c.excerpt
  }),
  "production.mentioned": (_n, c) => ({
    headline: `${c.actor} đã nhắc đến bạn trong ${c.hasTask ? `task ${c.taskRef}` : `job ${c.jobCode}`}`,
    facts: c.productionFacts,
    excerpt: c.excerpt
  }),
  "production.commented": (_n, c) => ({
    headline: `${c.actor} đã bình luận trong ${c.hasTask ? `task ${c.taskRef}` : `job ${c.jobCode}`}`,
    facts: c.productionFacts,
    excerpt: c.excerpt
  }),
  "production.leave_requested": (n, c) => {
    const requester = text(n.payload.requesterName) ?? c.title;
    const span = leaveSpan(n);
    return {
      headline: `${requester} xin nghỉ phép${span ? ` ${span}` : ""}`,
      facts: [
        ["Người xin nghỉ", requester],
        ...leaveFacts(n)
      ],
      excerpt: c.note
    };
  },
  "production.leave_decided": (n, c) => {
    const status = (text(n.payload.status) ?? text(n.payload.decision) ?? "").toUpperCase();
    return {
      headline:
        status === "APPROVED"
          ? "Đơn nghỉ phép của bạn đã được duyệt"
          : status === "REJECTED"
            ? "Đơn nghỉ phép của bạn bị từ chối"
            : "Đơn nghỉ phép của bạn đã được xử lý",
      facts: [...leaveFacts(n), ["Người duyệt", n.actorName?.trim() || null]],
      excerpt: c.note ?? text(n.payload.decisionNote)
    };
  },
  "production.kpi_settled": (n, c) => {
    const period = text(n.payload.period);
    const points = num(n.payload.points) ?? num(n.payload.score) ?? num(n.payload.totalPoints);
    const target = num(n.payload.target);
    const percent = num(n.payload.percent) ?? num(n.payload.kpiPercent);
    return {
      headline: period ? `Đã chốt KPI kỳ ${period}` : "Đã chốt KPI",
      facts: [
        ["Điểm", points !== null ? String(points) : null],
        ["Chỉ tiêu", target !== null ? String(target) : null],
        ["% KPI", percent !== null ? `${percent}%` : null]
      ],
      excerpt: c.excerpt
    };
  }
} satisfies Record<NotificationType, TemplateFn>;

const templateFor = (type: string): TemplateFn | undefined =>
  Object.prototype.hasOwnProperty.call(templates, type) ? templates[type as NotificationType] : undefined;

const clip = (value: string | null, max: number) => (value && value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** Renders one notification (unknown types fall back to title / body). */
export const renderNotificationSection = (notification: EmailNotification, baseUrl: string): NotificationSection => {
  const template = templateFor(notification.type);
  const context = contextOf(notification);
  const rendered: Template = template ? template(notification, context) : { headline: notification.title, excerpt: context.excerpt };
  const headline = rendered.headline.trim() || notification.title;
  return {
    subject: rendered.subject ?? headline,
    headline,
    facts: (rendered.facts ?? []).flatMap(([label, value]) => (value ? [{ label, value }] : [])),
    excerpt: clip(rendered.excerpt ?? null, 500),
    link: notificationLink(notification, baseUrl),
    time: formatDateTime(notification.createdAt)
  };
};

// Digest -----------------------------------------------------------------------------------------

export type DigestInput = {
  recipientName: string | null;
  items: EmailNotification[];
  /** Pending notifications not shown individually (the digest lists at most a page). */
  moreCount: number;
  baseUrl: string;
};

const colors = { page: "#f4f5f7", card: "#ffffff", text: "#111827", muted: "#6b7280", line: "#e5e7eb", brand: "#4f46e5" };
const fontStack = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const sectionHtml = (section: NotificationSection) => {
  const facts = section.facts.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0;font-size:13px;color:${colors.text}">${section.facts
        .map(
          (fact) =>
            `<tr><td style="padding:2px 12px 2px 0;color:${colors.muted};white-space:nowrap;vertical-align:top">${escapeHtml(fact.label)}</td><td style="padding:2px 0">${escapeHtml(fact.value)}</td></tr>`
        )
        .join("")}</table>`
    : "";
  const excerpt = section.excerpt
    ? `<div style="margin:10px 0 0;padding:8px 12px;border-left:3px solid ${colors.line};color:#374151;font-size:13px;line-height:1.5">${escapeHtml(section.excerpt).replace(/\r?\n/g, "<br>")}</div>`
    : "";
  return `<tr><td style="padding:16px 0;border-top:1px solid ${colors.line}">
<p style="margin:0;font-size:15px;line-height:1.4;font-weight:600;color:${colors.text}">${escapeHtml(section.headline)}</p>
${section.time ? `<p style="margin:2px 0 0;font-size:12px;color:${colors.muted}">${escapeHtml(section.time)}</p>` : ""}
${facts}${excerpt}
<p style="margin:12px 0 0"><a href="${escapeHtml(section.link)}" style="display:inline-block;padding:8px 14px;border-radius:6px;background:${colors.brand};color:#ffffff;font-size:13px;font-weight:600;text-decoration:none">Mở trong ${productName}</a></p>
</td></tr>`;
};

const sectionText = (section: NotificationSection) =>
  [
    `• ${section.headline}${section.time ? ` (${section.time})` : ""}`,
    ...section.facts.map((fact) => `  ${fact.label}: ${fact.value}`),
    ...(section.excerpt ? [`  “${section.excerpt.replace(/\r?\n/g, "\n   ")}”`] : []),
    `  Mở: ${section.link}`
  ].join("\n");

/** One e-mail combining every pending notification of a recipient. */
export const renderDigestEmail = (input: DigestInput): RenderedEmail => {
  const sections = input.items.map((item) => renderNotificationSection(item, input.baseUrl));
  const total = sections.length + Math.max(0, input.moreCount);
  const single = total === 1 ? sections[0] : undefined;
  const subject = single ? single.subject : `${total} thông báo mới — ${productName}`;
  const name = input.recipientName?.trim();
  const greeting = name ? `Chào ${name},` : "Chào bạn,";
  const intro = `Bạn có ${total} thông báo mới trong ${productName}:`;
  const inboxLink = joinUrl(input.baseUrl, "/inbox");
  const settingsLink = joinUrl(input.baseUrl, "/settings/profile");
  const more = input.moreCount > 0 ? `Và ${input.moreCount} thông báo khác — xem tất cả trong hộp thư` : null;
  const footer = `Bạn nhận e-mail này vì đã bật nhận thông báo qua e-mail trong ${productName}.`;

  const text = [
    greeting,
    "",
    intro,
    "",
    sections.map(sectionText).join("\n\n"),
    ...(more ? ["", `${more}: ${inboxLink}`] : []),
    "",
    "—",
    `${footer} Tắt trong cài đặt cá nhân: ${settingsLink}`
  ].join("\n");

  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${colors.page};font-family:${fontStack};color:${colors.text}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${colors.page}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${colors.card};border:1px solid ${colors.line};border-radius:8px">
<tr><td style="padding:24px 24px 8px">
<p style="margin:0 0 16px;font-size:13px;font-weight:700;letter-spacing:.02em;color:${colors.brand}">${productName}</p>
<p style="margin:0 0 4px;font-size:15px">${escapeHtml(greeting)}</p>
<p style="margin:0 0 8px;font-size:15px">${escapeHtml(intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${sections.map(sectionHtml).join("\n")}</table>
${more ? `<p style="margin:8px 0 0;font-size:13px"><a href="${escapeHtml(inboxLink)}" style="color:${colors.brand}">${escapeHtml(more)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:16px 24px 24px;font-size:12px;line-height:1.5;color:${colors.muted};border-top:1px solid ${colors.line}">
${escapeHtml(footer)} <a href="${escapeHtml(settingsLink)}" style="color:${colors.muted}">Tắt trong cài đặt cá nhân</a>.
</td></tr>
</table></td></tr></table>
</body></html>`;

  return { subject, text, html };
};
