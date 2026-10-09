import { session, storageFetch } from "./lib.mjs";
const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);

const mgr = await session("MANAGER");
const proj = (await mgr.call("POST", "/projects", { key: "X" + Math.random().toString(36).slice(2, 6).toUpperCase(), name: "QA – upload xss", visibility: "private" })).body;
const task = (await mgr.call("POST", `/projects/${proj.id}/tasks`, { listId: proj.lists[0].id, title: "xss" })).body;
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>';

for (const [declared, actual] of [["image/png", "image/svg+xml"], ["image/png", "text/xml"], ["image/png", "application/xhtml+xml"]]) {
  const ticket = (await mgr.call("POST", `/tasks/${task.id}/attachments`, { fileName: "a.png", mimeType: declared, sizeBytes: svg.length })).body;
  await storageFetch(ticket.uploadUrl, { method: "PUT", headers: { "content-type": actual }, body: svg });
  const done = await mgr.call("POST", `/attachments/${ticket.attachmentId}/complete`, { target: "task" });
  ok(`declared ${declared} but stored ${actual} rejected`, done.status === 400, done.body?.error?.code);
}
// Honest PDF upload is accepted and forced to download
const pdf = "%PDF-1.4 fake";
const ticket = (await mgr.call("POST", `/tasks/${task.id}/attachments`, { fileName: "report.pdf", mimeType: "application/pdf", sizeBytes: pdf.length })).body;
await storageFetch(ticket.uploadUrl, { method: "PUT", headers: { "content-type": "application/pdf" }, body: pdf });
const done = await mgr.call("POST", `/attachments/${ticket.attachmentId}/complete`, { target: "task" });
ok("honest pdf accepted", done.status === 200);
const urls = (await mgr.call("POST", "/attachments/urls", { ids: [ticket.attachmentId] })).body;
const res = await storageFetch(urls.items[0].url);
ok("non-image served as attachment", (res.headers.get("content-disposition") ?? "").startsWith("attachment"), res.headers.get("content-disposition") ?? "");
await mgr.call("DELETE", `/tasks/${task.id}`);
