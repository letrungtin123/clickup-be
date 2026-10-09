import { describe, expect, it } from "vitest";

import { notificationTypes } from "../../contracts/notifications.js";
import {
  escapeHtml,
  formatDateTime,
  notificationLink,
  notificationPath,
  renderDigestEmail,
  renderNotificationSection,
  type EmailNotification
} from "./email-templates.js";

const base = "https://work.example.com";
const ids = {
  project: "11111111-1111-4111-8111-111111111111",
  task: "22222222-2222-4222-8222-222222222222",
  channel: "33333333-3333-4333-8333-333333333333",
  message: "44444444-4444-4444-8444-444444444444",
  productionTask: "55555555-5555-4555-8555-555555555555",
  job: "66666666-6666-4666-8666-666666666666",
  thread: "77777777-7777-4777-8777-777777777777"
};

const make = (overrides: Partial<EmailNotification> = {}): EmailNotification => ({
  type: "task.assigned",
  title: "Thiết kế banner",
  body: null,
  actorName: "Linh",
  projectId: null,
  taskId: null,
  channelId: null,
  messageId: null,
  payload: {},
  createdAt: new Date("2026-10-09T10:00:00Z"),
  ...overrides
});

const productionPayload = {
  productionTaskId: ids.productionTask,
  jobId: ids.job,
  jobCode: "JOB-2026-001",
  taskNumber: 3,
  processName: "Retouch",
  qty: 20,
  deadline: "2026-10-10T10:00:00.000Z",
  note: "Da chưa mịn",
  from: 20,
  to: 18,
  feedbackType: "CLIENT",
  statusName: "Checked",
  status: "APPROVED",
  fromDate: "2026-10-12",
  toDate: "2026-10-13",
  part: "FULL_DAY",
  period: "2026-10",
  points: 1234,
  target: 1200,
  percent: 102.8
};

describe("escapeHtml", () => {
  it("escapes every HTML-significant character", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("notification links", () => {
  it("opens production tasks first, then jobs", () => {
    expect(notificationPath(make({ payload: { productionTaskId: ids.productionTask, jobId: ids.job } }))).toBe(
      `/production/tasks/${ids.productionTask}`
    );
    expect(notificationPath(make({ payload: { jobId: ids.job } }))).toBe(`/production/jobs/${ids.job}`);
  });

  it("opens work tasks in their project", () => {
    expect(notificationPath(make({ projectId: ids.project, taskId: ids.task }))).toBe(`/p/${ids.project}?task=${ids.task}`);
    expect(notificationPath(make({ type: "project.member_added", projectId: ids.project }))).toBe(`/p/${ids.project}`);
  });

  it("opens chat at the message (and thread)", () => {
    expect(notificationPath(make({ type: "chat.mentioned", channelId: ids.channel, messageId: ids.message }))).toBe(
      `/c/${ids.channel}?message=${ids.message}`
    );
    expect(
      notificationPath(
        make({ type: "chat.thread_replied", channelId: ids.channel, messageId: ids.message, payload: { threadRootId: ids.thread } })
      )
    ).toBe(`/c/${ids.channel}?thread=${ids.thread}&message=${ids.message}`);
  });

  it("opens the leave calendar for leave notifications", () => {
    for (const type of ["production.leave_requested", "production.leave_decided"]) {
      expect(notificationPath(make({ type, payload: { leaveId: ids.task } }))).toBe("/production/leave");
    }
  });

  it("falls back to the inbox and ignores ids that are not UUIDs", () => {
    expect(notificationPath(make())).toBe("/inbox");
    expect(notificationPath(make({ payload: { productionTaskId: "../../admin", jobId: "javascript:alert(1)" } }))).toBe("/inbox");
  });

  it("joins the public base URL without doubling slashes", () => {
    expect(notificationLink(make({ payload: { jobId: ids.job } }), `${base}/`)).toBe(`${base}/production/jobs/${ids.job}`);
  });
});

describe("templates", () => {
  it("gives every notification type a non-empty subject and headline", () => {
    for (const type of notificationTypes) {
      const section = renderNotificationSection(
        make({ type, body: "Nội dung", projectId: ids.project, taskId: ids.task, payload: { ...productionPayload, taskKey: "WEB-12" } }),
        base
      );
      expect(section.subject.trim(), type).not.toBe("");
      expect(section.headline.trim(), type).not.toBe("");
      expect(section.subject, type).not.toMatch(/undefined|null|\[object/);
      expect(section.headline, type).not.toMatch(/undefined|null|\[object/);
    }
  });

  it("still renders every type with an empty payload", () => {
    for (const type of notificationTypes) {
      const section = renderNotificationSection(make({ type, actorName: null }), base);
      expect(section.subject.trim(), type).not.toBe("");
      expect(section.subject, type).not.toMatch(/undefined|null/);
    }
  });

  it("renders work-task and production sentences in Vietnamese", () => {
    expect(renderNotificationSection(make({ payload: { taskKey: "WEB-12" } }), base).subject).toBe(
      "Linh đã giao cho bạn WEB-12: Thiết kế banner"
    );
    const qc = renderNotificationSection(make({ type: "production.qc_failed", title: "JOB-2026-001", payload: productionPayload }), base);
    expect(qc.headline).toBe("Task JOB-2026-001 #3 không đạt QC");
    expect(qc.excerpt).toBe("Da chưa mịn");
    expect(qc.facts).toContainEqual({ label: "Số lượng", value: "20 tấm" });
    expect(qc.facts).toContainEqual({ label: "Deadline", value: "17:00, 10/10/2026" });
    expect(qc.link).toBe(`${base}/production/tasks/${ids.productionTask}`);
    expect(
      renderNotificationSection(make({ type: "production.qty_changed", actorName: "Leader A", payload: productionPayload }), base).headline
    ).toBe("Leader A đã sửa số lượng task JOB-2026-001 #3: 20 → 18 tấm");
    expect(
      renderNotificationSection(make({ type: "production.commented", body: "Xem lại ảnh 5", payload: { jobId: ids.job, jobCode: "JOB-7" } }), base)
    ).toMatchObject({ headline: "Linh đã bình luận trong job JOB-7", excerpt: "Xem lại ảnh 5", link: `${base}/production/jobs/${ids.job}` });
    const leave = { leaveId: ids.task, requesterName: "Minh", fromDate: "2026-10-12", toDate: "2026-10-13", part: "FULL_DAY", status: "PENDING", note: null };
    expect(renderNotificationSection(make({ type: "production.leave_requested", title: "Minh", payload: leave }), base)).toMatchObject({
      headline: "Minh xin nghỉ phép 12/10/2026 – 13/10/2026",
      link: `${base}/production/leave`
    });
    const decided = renderNotificationSection(
      make({ type: "production.leave_decided", actorName: "Leader A", payload: { ...leave, status: "REJECTED", note: "Trùng lịch giao hàng" } }),
      base
    );
    expect(decided).toMatchObject({ headline: "Đơn nghỉ phép của bạn bị từ chối", excerpt: "Trùng lịch giao hàng" });
    expect(decided.facts).toContainEqual({ label: "Buổi", value: "Cả ngày" });
  });

  it("falls back to title / body for unknown types", () => {
    const section = renderNotificationSection(make({ type: "something.new", title: "Tiêu đề", body: "Chi tiết" }), base);
    expect(section).toMatchObject({ subject: "Tiêu đề", headline: "Tiêu đề", excerpt: "Chi tiết", link: `${base}/inbox` });
  });

  it("formats times in Asia/Ho_Chi_Minh", () => {
    expect(formatDateTime("2026-10-09T17:30:00Z")).toBe("00:30, 10/10/2026");
    expect(formatDateTime("not a date")).toBeNull();
  });
});

describe("renderDigestEmail", () => {
  const hostile = '<script>alert("x")</script>';

  it("escapes every interpolated value in the HTML part", () => {
    const mail = renderDigestEmail({
      recipientName: `Bob ${hostile}`,
      items: [
        make({
          type: "production.feedback",
          title: hostile,
          body: `${hostile}\nline 2`,
          actorName: hostile,
          payload: { jobId: ids.job, jobCode: hostile, feedbackType: hostile, note: hostile }
        }),
        make({ type: "task.mentioned", actorName: hostile, title: hostile, body: hostile, payload: { taskKey: hostile } })
      ],
      moreCount: 0,
      baseUrl: base
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    // Plain-text part is not HTML: values appear verbatim there.
    expect(mail.text).toContain(hostile);
  });

  it("uses the notification's own subject for a single item", () => {
    const mail = renderDigestEmail({ recipientName: "An", items: [make({ payload: { taskKey: "WEB-1" } })], moreCount: 0, baseUrl: base });
    expect(mail.subject).toBe("Linh đã giao cho bạn WEB-1: Thiết kế banner");
    expect(mail.text).toContain("Chào An,");
  });

  it("combines several notifications with one section and link each", () => {
    const mail = renderDigestEmail({
      recipientName: null,
      items: [
        make({ projectId: ids.project, taskId: ids.task, payload: { taskKey: "WEB-1" } }),
        make({ type: "production.task_waiting_qc", title: "JOB-1", payload: { productionTaskId: ids.productionTask, jobCode: "JOB-1", taskNumber: 2 } }),
        make({ type: "chat.mentioned", title: "thiet-ke", body: "@bạn xem giúp", channelId: ids.channel, messageId: ids.message })
      ],
      moreCount: 2,
      baseUrl: base
    });
    expect(mail.subject).toBe("5 thông báo mới — Nesso Work");
    expect(mail.text).toContain("Chào bạn,");
    for (const link of [
      `${base}/p/${ids.project}?task=${ids.task}`,
      `${base}/production/tasks/${ids.productionTask}`,
      `${base}/c/${ids.channel}?message=${ids.message}`,
      `${base}/inbox`,
      `${base}/settings/profile`
    ]) {
      expect(mail.text).toContain(link);
      expect(mail.html).toContain(`href="${escapeHtml(link)}"`);
    }
    expect(mail.text).toContain("Và 2 thông báo khác");
    expect(mail.html.match(/Mở trong Nesso Work/g)).toHaveLength(3);
  });
});
