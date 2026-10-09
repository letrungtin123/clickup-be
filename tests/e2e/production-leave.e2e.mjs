// Production (Photo Retouch) shared leave calendar — SPEC §6.3 / PLAN §10 "Lịch nghỉ":
// create, overlap 409, half-day rules, visibility, decide permissions, cancel, realtime hint.
import { createRequire } from "node:module";
import { apiOrigin, bumpAuthz, localSql, seed, session } from "./lib.mjs";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { io } = require("socket.io-client");

const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${cond ? "" : typeof extra === "string" ? extra : JSON.stringify(extra)}`);
const quote = (text) => `'${String(text).replaceAll("'", "''")}'`;
const marker = "[e2e-leave]";

// Business calendar helpers (Asia/Ho_Chi_Minh).
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (day, days) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
// Far enough ahead to avoid manual test data, inside the 366-day limit.
const base = addDays(today, 300);
const d = (offset) => addDays(base, offset);

// Setup (local DB only): MANAGER = production ADMIN, MEMBER_A = LEADER+QC, MEMBER_B = STAFF, MEMBER_C = none.
const email = (who) => quote(seed[`SEED_${who}_EMAIL`].toLowerCase());
const grant = (who, roles) =>
  roles
    .map(
      (role) => `
  INSERT INTO production.user_roles (organization_id, user_id, role_code)
  SELECT om.organization_id, au.id, '${role}' FROM public.app_users au
  JOIN public.organization_memberships om ON om.user_id = au.id AND om.deleted_at IS NULL
  WHERE lower(au.email) = ${email(who)}
  ON CONFLICT DO NOTHING;`
    )
    .join("");
localSql(`
  DELETE FROM production.user_roles WHERE user_id IN (SELECT id FROM public.app_users WHERE lower(email) IN (${["MEMBER_A", "MEMBER_B", "MEMBER_C"].map(email).join(",")}));
  ${grant("MANAGER", ["ADMIN"])}
  ${grant("MEMBER_A", ["LEADER", "QC"])}
  ${grant("MEMBER_B", ["STAFF"])}
  DELETE FROM production.leave_requests WHERE note LIKE ${quote(`${marker}%`)};
`);
bumpAuthz();

const admin = await session("MANAGER");
const a = await session("MEMBER_A");
const b = await session("MEMBER_B");
const outsider = await session("MEMBER_C");
const contextOf = async (s) => (await s.call("GET", "/workspace/context")).body;
const cal = (from, to) => `/production/leave?from=${from}&to=${to}`;
const find = (res, id) => res.body?.items?.find((item) => item.id === id);
const note = (text) => `${marker} ${text}`;

try {
  // Visibility (PD-011)
  let r = await outsider.call("GET", cal(d(0), d(40)));
  ok("non-member gets 404 on the calendar", r.status === 404 && r.body.error.code === "PRODUCTION_NOT_FOUND", r.body);
  r = await outsider.call("POST", "/production/leave", { fromDate: d(0), toDate: d(0), note: note("outsider") });
  ok("non-member cannot file leave (404)", r.status === 404, r.body);
  r = await outsider.call("GET", "/production/leave/pending");
  ok("non-member gets 404 on the queue", r.status === 404, r.body);

  // Create
  r = await b.call("POST", "/production/leave", { fromDate: d(0), toDate: d(2), note: note("B private reason") });
  const bLeave = r.body;
  ok(
    "STAFF files a full-day request (PENDING, 3 days)",
    r.status === 201 && bLeave.status === "PENDING" && bLeave.days === 3 && bLeave.part === "FULL_DAY" && bLeave.canCancel && !bLeave.canDecide,
    r.body
  );
  const bId = bLeave.user.id;

  r = await b.call("POST", "/production/leave", { fromDate: d(2), toDate: d(4), note: note("overlap") });
  ok("overlapping request → 409 LEAVE_OVERLAP (Vietnamese)", r.status === 409 && r.body.error.code === "LEAVE_OVERLAP" && /trùng/.test(r.body.error.message), r.body);
  r = await b.call("POST", "/production/leave", { fromDate: d(3), toDate: d(3), note: note("adjacent") });
  ok("adjacent day is not an overlap", r.status === 201, r.body);

  // Half days
  r = await b.call("POST", "/production/leave", { fromDate: d(10), toDate: d(10), part: "MORNING", note: note("B morning") });
  const bMorning = r.body;
  ok("half day (MORNING) counts 0.5", r.status === 201 && bMorning.days === 0.5 && bMorning.part === "MORNING", r.body);
  r = await b.call("POST", "/production/leave", { fromDate: d(10), toDate: d(10), part: "AFTERNOON", note: note("B afternoon") });
  const bAfternoon = r.body;
  ok("MORNING + AFTERNOON of the same day coexist", r.status === 201 && bAfternoon.part === "AFTERNOON", r.body);
  r = await b.call("POST", "/production/leave", { fromDate: d(10), toDate: d(10), part: "MORNING", note: note("dup morning") });
  ok("second MORNING on the same day → 409", r.status === 409 && r.body.error.code === "LEAVE_OVERLAP", r.body);
  r = await b.call("POST", "/production/leave", { fromDate: d(9), toDate: d(11), note: note("full over halves") });
  ok("full-day range over half days → 409", r.status === 409, r.body);
  r = await b.call("POST", "/production/leave", { fromDate: d(11), toDate: d(12), part: "AFTERNOON", note: note("bad half") });
  ok("half day over several days → 400 LEAVE_HALF_DAY_RANGE", r.status === 400 && r.body.error.code === "LEAVE_HALF_DAY_RANGE", r.body);

  // Validation
  r = await b.call("POST", "/production/leave", { fromDate: d(15), toDate: d(14) });
  ok("reversed dates → 400 LEAVE_RANGE_INVALID", r.status === 400 && r.body.error.code === "LEAVE_RANGE_INVALID", r.body);
  r = await b.call("POST", "/production/leave", { fromDate: d(15), toDate: d(46) });
  ok("32-day request → 400 LEAVE_TOO_LONG", r.status === 400 && r.body.error.code === "LEAVE_TOO_LONG", r.body);
  r = await b.call("POST", "/production/leave", { fromDate: addDays(today, -31), toDate: addDays(today, -31) });
  ok("more than 30 days in the past → 400 LEAVE_TOO_OLD", r.status === 400 && r.body.error.code === "LEAVE_TOO_OLD", r.body);
  r = await b.call("POST", "/production/leave", { fromDate: "2027-02-30", toDate: "2027-03-01" });
  ok("impossible date → 400 LEAVE_DATE_INVALID", r.status === 400 && r.body.error.code === "LEAVE_DATE_INVALID", r.body);
  r = await b.call("POST", "/production/leave", { fromDate: d(15), toDate: d(15), userId: bId });
  ok("cannot file for someone else (strict body → 400)", r.status === 400, r.body);
  r = await b.call("GET", cal(d(0), d(93)));
  ok("calendar window > 93 days → 400", r.status === 400 && r.body.error.code === "LEAVE_WINDOW_TOO_LONG", r.body);
  r = await b.call("GET", "/production/leave");
  ok("calendar requires from/to → 400", r.status === 400, r.body);

  // Leader's own request and pending visibility
  r = await a.call("POST", "/production/leave", { fromDate: d(20), toDate: d(21), note: note("A private reason") });
  const aLeave = r.body;
  ok("LEADER files own request", r.status === 201 && aLeave.status === "PENDING" && !aLeave.canDecide, r.body);
  r = await b.call("GET", cal(d(0), d(30)));
  ok("STAFF does not see others' PENDING requests", r.status === 200 && !find(r, aLeave.id), r.body?.items?.map((i) => i.id));
  ok("STAFF sees own PENDING request with note", find(r, bLeave.id)?.note === note("B private reason"));
  r = await a.call("GET", cal(d(0), d(30)));
  const bSeenByA = find(r, bLeave.id);
  ok("LEADER sees every PENDING request with notes", r.status === 200 && bSeenByA?.note === note("B private reason") && bSeenByA.canDecide && !bSeenByA.canCancel, bSeenByA);
  ok("LEADER cannot decide own request (flag)", find(r, aLeave.id)?.canDecide === false);
  r = await admin.call("GET", cal(d(0), d(30)));
  ok("ADMIN sees PENDING requests", Boolean(find(r, bLeave.id)) && Boolean(find(r, aLeave.id)) && find(r, aLeave.id).canDecide);

  // Approval queue
  r = await b.call("GET", "/production/leave/pending");
  ok("STAFF cannot open the approval queue (403)", r.status === 403, r.body);
  r = await a.call("GET", "/production/leave/pending");
  ok("LEADER approval queue lists pending requests", r.status === 200 && Boolean(find(r, bLeave.id)) && Boolean(find(r, aLeave.id)), r.status);

  // Decide permissions
  r = await b.call("POST", `/production/leave/${bLeave.id}/decide`, { decision: "APPROVED" });
  ok("STAFF cannot decide (403)", r.status === 403, r.body);
  r = await a.call("POST", `/production/leave/${aLeave.id}/decide`, { decision: "APPROVED" });
  ok("LEADER cannot approve own request (403 LEAVE_SELF_DECISION)", r.status === 403 && r.body.error.code === "LEAVE_SELF_DECISION", r.body);
  r = await a.call("POST", `/production/leave/${bLeave.id}/decide`, { decision: "MAYBE" });
  ok("invalid decision → 400", r.status === 400, r.body);
  r = await a.call("POST", `/production/leave/${bLeave.id}/decide`, { decision: "APPROVED", note: "OK" });
  ok("LEADER approves STAFF request", r.status === 200 && r.body.status === "APPROVED" && r.body.decidedBy?.id !== bId && r.body.decisionNote === "OK" && r.body.decidedAt, r.body);
  r = await a.call("POST", `/production/leave/${bLeave.id}/decide`, { decision: "REJECTED" });
  ok("deciding twice → 409 LEAVE_NOT_PENDING", r.status === 409 && r.body.error.code === "LEAVE_NOT_PENDING", r.body);
  r = await admin.call("POST", `/production/leave/${aLeave.id}/decide`, { decision: "APPROVED" });
  ok("ADMIN approves the LEADER's request", r.status === 200 && r.body.status === "APPROVED", r.body);
  r = await admin.call("POST", "/production/leave", { fromDate: d(25), toDate: d(25), note: note("admin own") });
  const adminLeave = r.body;
  r = await admin.call("POST", `/production/leave/${adminLeave.id}/decide`, { decision: "APPROVED" });
  ok("ADMIN may approve own request", r.status === 200 && r.body.status === "APPROVED", r.body);
  r = await a.call("POST", `/production/leave/${bMorning.id}/decide`, { decision: "REJECTED", note: "Thiếu người" });
  ok("LEADER rejects a half day", r.status === 200 && r.body.status === "REJECTED", r.body);
  r = await a.call("POST", "/production/leave/00000000-0000-4000-8000-000000000000/decide", { decision: "APPROVED" });
  ok("unknown request → 404 LEAVE_NOT_FOUND", r.status === 404 && r.body.error.code === "LEAVE_NOT_FOUND", r.body);

  // Approved visibility: everyone sees names + dates, notes only for owner / LEADER / ADMIN
  r = await b.call("GET", cal(d(0), d(30)));
  const aSeenByB = find(r, aLeave.id);
  ok("STAFF sees others' APPROVED leave", aSeenByB?.status === "APPROVED" && aSeenByB.user.displayName.length > 0, aSeenByB);
  ok("…without note, decision note, decider or email", aSeenByB && aSeenByB.note === null && aSeenByB.decisionNote === null && aSeenByB.decidedBy === null && aSeenByB.user.email === null, aSeenByB);
  ok("…and cannot cancel or decide it", aSeenByB && !aSeenByB.canCancel && !aSeenByB.canDecide);
  const rejected = find(r, bMorning.id);
  ok("owner sees own REJECTED request with the decision note", rejected?.status === "REJECTED" && rejected.decisionNote === "Thiếu người" && !rejected.canCancel, rejected);
  r = await a.call("GET", cal(d(0), d(30)));
  ok("LEADER does not see others' REJECTED requests", !find(r, bMorning.id));
  ok("LEADER sees the note of an APPROVED request", find(r, bLeave.id)?.note === note("B private reason"));
  r = await b.call("GET", cal(d(22), d(30)));
  ok("calendar window filters by date", r.status === 200 && !find(r, bLeave.id) && !find(r, aLeave.id) && Boolean(find(r, adminLeave.id)), r.body?.items?.map((i) => i.fromDate));
  ok("calendar returns today (business tz)", r.body.today === today, r.body.today);

  r = await b.call("POST", "/production/leave", { fromDate: d(10), toDate: d(10), part: "MORNING", note: note("B morning again") });
  ok("a rejected slot can be requested again", r.status === 201, r.body);

  // Cancel
  r = await a.call("POST", `/production/leave/${bLeave.id}/cancel`);
  ok("LEADER cannot cancel someone else's request (403)", r.status === 403, r.body);
  r = await b.call("POST", `/production/leave/${aLeave.id}/cancel`);
  ok("STAFF cannot cancel someone else's request (403)", r.status === 403, r.body);
  r = await b.call("POST", `/production/leave/${bLeave.id}/cancel`);
  ok("owner cancels an APPROVED future request", r.status === 200 && r.body.status === "CANCELLED" && r.body.cancelledAt && !r.body.canCancel, r.body);
  r = await b.call("POST", `/production/leave/${bLeave.id}/cancel`);
  ok("cancelling twice → 409 LEAVE_NOT_CANCELLABLE", r.status === 409 && r.body.error.code === "LEAVE_NOT_CANCELLABLE", r.body);
  r = await b.call("POST", "/production/leave", { fromDate: d(1), toDate: d(2), note: note("after cancel") });
  ok("a cancelled slot can be requested again", r.status === 201, r.body);
  r = await b.call("POST", `/production/leave/${bAfternoon.id}/cancel`);
  ok("owner cancels a PENDING request", r.status === 200 && r.body.status === "CANCELLED", r.body);

  const started = addDays(today, -25);
  r = await b.call("POST", "/production/leave", { fromDate: started, toDate: addDays(started, 1), note: note("started") });
  const bStarted = r.body;
  ok("request up to 30 days in the past is accepted", r.status === 201 && bStarted.canCancel === false, r.body);
  await a.call("POST", `/production/leave/${bStarted.id}/decide`, { decision: "APPROVED" });
  r = await b.call("POST", `/production/leave/${bStarted.id}/cancel`);
  ok("owner cannot cancel a started request (409 LEAVE_ALREADY_STARTED)", r.status === 409 && r.body.error.code === "LEAVE_ALREADY_STARTED", r.body);
  r = await admin.call("GET", cal(started, started));
  ok("ADMIN may cancel it (flag)", find(r, bStarted.id)?.canCancel === true);
  r = await admin.call("POST", `/production/leave/${bStarted.id}/cancel`);
  ok("ADMIN cancels a started request", r.status === 200 && r.body.status === "CANCELLED", r.body);

  // Realtime cache hint for the production room
  const socket = await new Promise((resolve, reject) => {
    const s = io(apiOrigin, { path: "/socket.io", transports: ["websocket"], extraHeaders: { cookie: b.cookieHeader() }, reconnection: false });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
  try {
    const orgId = (await contextOf(b)).organization.id;
    const ack = await new Promise((resolve) => socket.emit("room:join", { type: "production", id: orgId }, resolve));
    const event = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 4000);
      socket.once("production:leave", (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
    await a.call("POST", "/production/leave", { fromDate: d(28), toDate: d(28), part: "AFTERNOON", note: note("realtime") });
    const payload = await event;
    ok("production room receives production:leave hint", ack?.ok === true && typeof payload?.at === "string", { ack, payload });
  } finally {
    socket.close();
  }
  // "Đơn của tôi" and the team filter
  {
    const mine = await b.call("GET", "/production/leave/mine");
    const meB = (await contextOf(b)).user.id;
    ok("my requests list returns only mine", mine.status === 200 && mine.body.items.every((item) => item.user.id === meB), mine.body);
    const team = await b.call("GET", `/production/leave?from=${d(0)}&to=${d(60)}&teamId=00000000-0000-4000-8000-000000000000`);
    ok("team filter narrows the calendar", team.status === 200 && team.body.items.every((item) => item.team?.id === "00000000-0000-4000-8000-000000000000"), team.body);
  }

  // Notifications (SPEC §6.3): request → production admins (+ team leaders); decision → requester.
  {
    const waitFor = async (who, type, predicate) => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const page = (await who.call("GET", `/notifications?types=${type}&limit=50`)).body;
        const found = page.items?.find(predicate);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return null;
    };
    const created = await b.call("POST", "/production/leave", { fromDate: d(40), toDate: d(41), part: "FULL_DAY", note: note("notify") });
    const leaveId = created.body?.id;
    const requested = await waitFor(admin, "production.leave_requested", (item) => item.payload.leaveId === leaveId);
    ok("admin notified of a new leave request", Boolean(requested), created.body);
    await admin.call("POST", `/production/leave/${leaveId}/decide`, { decision: "APPROVED" });
    const decided = await waitFor(b, "production.leave_decided", (item) => item.payload.leaveId === leaveId);
    ok("requester notified of the decision", decided?.payload.status === "APPROVED", decided ?? "none");
  }
} finally {
  // Cleanup: remove every row this suite created.
  localSql(`DELETE FROM production.leave_requests WHERE note LIKE ${quote(`${marker}%`)};`);
}
