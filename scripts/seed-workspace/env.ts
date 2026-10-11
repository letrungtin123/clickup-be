/**
 * Runtime environment shared by the planners: personas, roles, contexts, the action timeline and uploads.
 * Imported only after the module hooks are registered (see ../seed-workspace.ts).
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import type postgres from "postgres";

import type { RichTextDoc } from "../../src/contracts/rich-text.js";
import { getSql } from "../../src/db/client.js";
import type { AccessContext } from "../../src/modules/access/access-context.js";
import { getWorkspaceContext } from "../../src/modules/workspace/workspace.service.js";
import { toDoc } from "./markup.js";
import { DAY, HOUR, MINUTE, Rng, at } from "./time.js";
import { productionStaff, type FileSpec, type PersonaKey } from "./types.js";

export type RoleKey = "superadmin" | "admin" | "manager" | "truong_nhom_du_an" | "member";

export type Persona = {
  key: PersonaKey;
  id: string;
  email: string;
  label: string;
  role: RoleKey;
  /** Instant the person left (account disabled), null = still active. */
  leftAt: number | null;
};

export const allPersonaKeys: PersonaKey[] = [
  "boss", "linh", "admin", "minh", "an", "khoa", "lead1", "lead2", "acc1", "acc2", ...productionStaff, "loc", "hanh"
];

export const personaEmails: Record<PersonaKey, string> = {
  // The organization's superadmin account (resolved by role, see engine.ts resolvePersonas).
  boss: "",
  linh: "linh.manager@nesso.test",
  admin: "admin01@test.local",
  minh: "minh.dev@nesso.test",
  an: "an.design@nesso.test",
  khoa: "khoa.qa@nesso.test",
  lead1: "lead01@test.local",
  lead2: "lead02@test.local",
  acc1: "acc01@test.local",
  acc2: "acc02@test.local",
  nv01: "nv01@test.local", nv02: "nv02@test.local", nv03: "nv03@test.local", nv04: "nv04@test.local",
  nv05: "nv05@test.local", nv06: "nv06@test.local", nv07: "nv07@test.local", nv08: "nv08@test.local",
  nv09: "nv09@test.local", nv10: "nv10@test.local", nv11: "nv11@test.local", nv12: "nv12@test.local",
  nv13: "nv13@test.local", nv14: "nv14@test.local", nv15: "nv15@test.local",
  loc: "loc.pham@nesso.test",
  hanh: "hanh.do@nesso.test"
};

/** Ex-employees created by this seed (disabled at `leftAt`). */
export const exEmployees = [
  { key: "loc" as const, envKey: "EX_LOC", displayName: "Phạm Văn Lộc", jobTitle: "Retoucher", leftAt: at("2026-09-12", 17, 30) },
  { key: "hanh" as const, envKey: "EX_HANH", displayName: "Đỗ Thu Hạnh", jobTitle: "Thực tập sinh marketing", leftAt: at("2026-09-30", 17, 45) }
];

export const roleOfPersona = (key: PersonaKey): RoleKey => {
  switch (key) {
    case "boss":
      return "superadmin";
    case "admin":
      return "admin";
    case "linh":
    case "lead1":
    case "lead2":
      return "manager";
    case "an":
    case "minh":
    case "khoa":
    case "acc1":
      return "truong_nhom_du_an";
    default:
      return "member";
  }
};

export const jobTitles: Partial<Record<PersonaKey, string>> = {
  linh: "Trưởng phòng vận hành",
  minh: "Kỹ sư phần mềm nội bộ",
  an: "Thiết kế đồ hoạ & marketing",
  khoa: "Trưởng nhóm QC"
};

// Timeline ---------------------------------------------------------------------------------------------

export type Action = { at: number; order: number; label: string; actor: PersonaKey | null; run: () => Promise<unknown> };

export type Stats = Map<string, number>;

export class SeedEnv {
  readonly sql: postgres.Sql = getSql();
  readonly rng: Rng;
  readonly now: number;
  /** Last instant actions may be planned at (a minute before the run started). */
  readonly planEnd: number;
  readonly start: number = at("2026-08-25", 8, 0);
  organizationId = "";
  readonly personas = new Map<PersonaKey, Persona>();
  /** Persona key → effective key (missing lead2/acc2 fall back to lead1/acc1). */
  readonly alias = new Map<PersonaKey, PersonaKey>();
  readonly rolePermissions = new Map<RoleKey, Set<string>>();
  readonly actions: Action[] = [];
  readonly stats: Stats = new Map();
  readonly errors: { label: string; message: string }[] = [];
  private readonly contexts = new Map<string, AccessContext>();
  private order = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.now = Date.now();
    this.planEnd = this.now - 2 * MINUTE;
  }

  count(key: string, by = 1) {
    this.stats.set(key, (this.stats.get(key) ?? 0) + by);
  }

  key(key: PersonaKey): PersonaKey {
    return this.alias.get(key) ?? key;
  }

  p(key: PersonaKey): Persona {
    const persona = this.personas.get(this.key(key));
    if (!persona) {
      throw new Error(`Unknown persona ${key}`);
    }
    return persona;
  }

  has(key: PersonaKey) {
    return this.personas.has(this.key(key));
  }

  /** Still employed at instant `t`. */
  active(key: PersonaKey, t: number) {
    const persona = this.personas.get(this.key(key));
    return Boolean(persona) && (persona!.leftAt === null || t < persona!.leftAt);
  }

  can(key: PersonaKey, permission: string) {
    const persona = this.p(key);
    if (persona.role === "superadmin") {
      return true;
    }
    return this.rolePermissions.get(persona.role)?.has(permission) ?? false;
  }

  async ctx(key: PersonaKey): Promise<AccessContext> {
    const persona = this.p(key);
    const cached = this.contexts.get(persona.id);
    if (cached) {
      return cached;
    }
    const context = await getWorkspaceContext(persona.id);
    this.contexts.set(persona.id, context);
    return context;
  }

  forgetContexts() {
    this.contexts.clear();
  }

  schedule(at: number, label: string, actor: PersonaKey | null, run: () => Promise<unknown>) {
    this.actions.push({ at, order: this.order++, label, actor, run });
  }

  /** Clamps an instant into the seeded period. */
  clamp(t: number) {
    return Math.min(Math.max(t, this.start), this.planEnd);
  }

  /** Mini-markup → document. `canMention` decides who becomes a real mention (others become plain "@Name"). */
  doc(text: string, canMention: (key: PersonaKey, t: number) => boolean, t: number): RichTextDoc {
    return toDoc(text, (raw) => {
      if (!(allPersonaKeys as string[]).includes(raw)) {
        return null;
      }
      const key = raw as PersonaKey;
      if (!this.has(key)) {
        return null;
      }
      const persona = this.p(key);
      return { id: canMention(key, t) && this.active(key, t) ? persona.id : null, label: persona.label };
    });
  }

  // Files --------------------------------------------------------------------------------------------

  /** Generates a file and PUTs it to a signed upload URL (same-origin path → Supabase gateway). */
  async putFile(uploadUrl: string, bytes: Buffer, mimeType: string) {
    const target = /^https?:\/\//.test(uploadUrl) ? uploadUrl : new URL(uploadUrl, process.env.SUPABASE_URL).toString();
    const response = await fetch(target, { method: "PUT", headers: { "content-type": mimeType }, body: new Uint8Array(bytes) });
    if (!response.ok) {
      throw new Error(`storage PUT ${response.status}`);
    }
  }

  async makeFile(spec: FileSpec) {
    const { generateFile } = await import("./files.js");
    const generated = await generateFile(spec.name, spec.hint);
    return { name: spec.name, bytes: generated.bytes, mimeType: generated.mimeType };
  }
}

// Accounts -------------------------------------------------------------------------------------------------

const seedFile = new URL("../../.env.seed", import.meta.url);

/** Password for a seed-created account, kept in the git-ignored BE/.env.seed (never printed). */
export const ensureSeedPassword = (envKey: string, email: string) => {
  const text = existsSync(seedFile) ? readFileSync(seedFile, "utf8") : "";
  const match = new RegExp(`^SEED_${envKey}_PASSWORD=(.+)$`, "m").exec(text);
  if (match?.[1]) {
    return match[1].trim();
  }
  const password = `Dev-${randomBytes(9).toString("base64url")}`;
  const suffix = `${text.endsWith("\n") || text.length === 0 ? "" : "\n"}SEED_${envKey}_EMAIL=${email}\nSEED_${envKey}_PASSWORD=${password}\n`;
  writeFileSync(seedFile, text + suffix);
  return password;
};

export const gotrueAdmin = async (path: string, init: RequestInit) => {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const response = await fetch(new URL(`/auth/v1/admin${path}`, process.env.SUPABASE_URL), {
    ...init,
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" }
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
};

/** Working-day instant `days` before `from` at a random office time. */
export const officeTime = (rng: Rng, date: string, from = 8, to = 17.5) =>
  at(date) + Math.round(rng.float(from, to) * HOUR / MINUTE) * MINUTE;

export const days = (n: number) => n * DAY;
