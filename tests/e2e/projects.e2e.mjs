import { session } from "./lib.mjs";
const ok = (label, cond, extra = "") => console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);

const mgr = await session("MANAGER");
const mem = await session("MEMBER_A");
const key = "T" + Math.random().toString(36).slice(2, 6).toUpperCase();

let r = await mgr.call("POST", "/projects", { key, name: "QA – projects private", visibility: "private", color: "violet" });
const priv = r.body;
ok("create private project", r.status === 201 && priv.key === key && priv.myAccess === "manage" && priv.lists.length === 1);
r = await mgr.call("POST", "/projects", { key: `${key}P`, name: "QA – projects public", visibility: "public" });
const pub = r.body;
ok("create public project", r.status === 201 && pub.visibility === "public");

r = await mem.call("GET", "/projects");
const visible = r.body.items.map((project) => project.id);
ok("member cannot see private project", !visible.includes(priv.id));
ok("member sees public project with submit", visible.includes(pub.id) && r.body.items.find((project) => project.id === pub.id).myAccess === "submit");
r = await mem.call("GET", `/projects/${priv.id}`);
ok("member GET private project is 404", r.status === 404);

r = await mgr.call("POST", `/projects/${priv.id}/lists`, { name: "Sprint 1" });
const list2 = r.body;
ok("create list", r.status === 201);
r = await mgr.call("PATCH", `/projects/${priv.id}/lists/${list2.id}`, { placement: { beforeId: priv.lists[0].id } });
ok("reorder list before the first", r.status === 200 && r.body.rank < priv.lists[0].rank, `${r.body.rank} < ${priv.lists[0].rank}`);

r = await mgr.call("POST", `/projects/${priv.id}/members`, { userId: "00000000-0000-4000-8000-000000000001", accessLevel: "submit" });
ok("adding a non-member of the org is 404", r.status === 404, r.body?.error?.code);
r = await mem.call("POST", `/projects/${pub.id}/lists`, { name: "x" });
ok("member cannot create lists on a public project", r.status === 403, r.body?.error?.code);
r = await mgr.call("POST", "/projects", { key, name: "dup" });
ok("duplicate key is 409", r.status === 409, r.body?.error?.code);
r = await mgr.call("POST", "/projects", { key: "bad key", name: "x" });
ok("invalid key is 400", r.status === 400);
