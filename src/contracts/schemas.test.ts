import { describe, expect, it } from "vitest";

import { ChannelNameSchema, normalizeReactionEmoji, ReactionEmojiSchema } from "./chat.js";
import {
  AccountEmailSchema,
  ChangePasswordRequestSchema,
  IsoDateInputSchema,
  MimeTypeSchema,
  NewPasswordSchema,
  SafeLineSchema,
  SafeMultilineSchema,
  SafeSearchSchema
} from "./schemas.js";
import { CreateTaskRequestSchema, TaskQuerySchema, UpdateListRequestSchema, UpdateProjectRequestSchema } from "./work.js";

const char = (code: number) => String.fromCodePoint(code);
const NUL = char(0);
const RLO = char(0x202e);
const ZWSP = char(0x200b);
const VS16 = char(0xfe0f);
const listId = "3f0c1d9e-8a4b-4c2d-9e1f-2a3b4c5d6e7f";

describe("shared text rules (SEC-API-08, WK-32)", () => {
  it("rejects control characters (NUL) in titles, names, descriptions, search and MIME types", () => {
    expect(SafeLineSchema(240).safeParse(`Task${NUL}`).success).toBe(false);
    expect(SafeMultilineSchema(1000).safeParse(`line${NUL}`).success).toBe(false);
    expect(SafeSearchSchema(200).safeParse(`q${NUL}`).success).toBe(false);
    expect(MimeTypeSchema.safeParse(`text/plain${NUL}`).success).toBe(false);
    expect(CreateTaskRequestSchema.safeParse({ listId, title: `a${NUL}b` }).success).toBe(false);
  });

  it("keeps line breaks in multi-line text but not in single-line names", () => {
    expect(SafeMultilineSchema(1000).parse("line 1\nline 2\tx")).toBe("line 1\nline 2\tx");
    expect(SafeLineSchema(160).safeParse("line 1\nline 2").success).toBe(false);
  });

  it("rejects bidi overrides and invisible-only names", () => {
    expect(SafeLineSchema(160).safeParse(`invoice${RLO}fdp.exe`).success).toBe(false);
    expect(SafeLineSchema(160).safeParse(`${ZWSP}${ZWSP} `).success).toBe(false);
    expect(ChannelNameSchema.safeParse(`general${RLO}`).success).toBe(false);
    expect(ChannelNameSchema.safeParse(ZWSP).success).toBe(false);
    expect(SafeLineSchema(160).parse("  Thiết kế màn hình  ")).toBe("Thiết kế màn hình");
  });

  it("bounds request years to 1970-2100 (no year 0000 / 0099 reaching PostgreSQL)", () => {
    expect(IsoDateInputSchema.safeParse("0000-01-01T00:00:00Z").success).toBe(false);
    expect(IsoDateInputSchema.safeParse("0099-01-01T00:00:00Z").success).toBe(false);
    expect(IsoDateInputSchema.safeParse("2101-01-01T00:00:00Z").success).toBe(false);
    expect(IsoDateInputSchema.safeParse("2026-10-10T07:00:00+07:00").success).toBe(true);
    expect(TaskQuerySchema.safeParse({ dueFrom: "0000-01-01T00:00:00Z" }).success).toBe(false);
  });

  it("validates MIME types as type/subtype", () => {
    expect(MimeTypeSchema.safeParse("image/png").success).toBe(true);
    expect(MimeTypeSchema.safeParse("text/plain; charset=utf-8").success).toBe(true);
    expect(MimeTypeSchema.safeParse("png").success).toBe(false);
  });
});

describe("empty PATCH bodies are rejected (WK-61)", () => {
  it("needs at least one field for projects and lists", () => {
    expect(UpdateProjectRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateListRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateProjectRequestSchema.safeParse({ name: "X" }).success).toBe(true);
  });
});

describe("passwords (BUG-WK-09)", () => {
  it("caps new passwords at 72 UTF-8 bytes (bcrypt) with a Vietnamese message", () => {
    expect(NewPasswordSchema.safeParse(`${"a".repeat(71)}1`).success).toBe(true);
    const tooLong = NewPasswordSchema.safeParse(`${"a".repeat(72)}1`);
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.message).toContain("72 byte");
    // 25 × "ệ" (3 bytes each) = 75 bytes although only 26 characters.
    expect(NewPasswordSchema.safeParse(`${"ệ".repeat(25)}1`).success).toBe(false);
    expect(ChangePasswordRequestSchema.safeParse({ currentPassword: "x", newPassword: `${"b".repeat(100)}2` }).success).toBe(false);
  });
});

describe("account e-mails (WK-34)", () => {
  it("accepts what the database accepts and nothing else", () => {
    expect(AccountEmailSchema.parse(" New.User+tag@Nesso.test ")).toBe("new.user+tag@nesso.test");
    expect(AccountEmailSchema.safeParse("o'brien@nesso.test").success).toBe(false);
  });
});

describe("reaction emoji normalization (WK-63)", () => {
  it("treats ❤ and ❤️ as one reaction", () => {
    const heart = char(0x2764);
    expect(normalizeReactionEmoji(heart)).toBe(`${heart}${VS16}`);
    expect(normalizeReactionEmoji(`${heart}${VS16}`)).toBe(`${heart}${VS16}`);
    expect(ReactionEmojiSchema.parse(heart)).toBe(ReactionEmojiSchema.parse(`${heart}${VS16}`));
  });

  it("leaves emoji-presentation characters, skin tones, ZWJ sequences and shortcodes alone", () => {
    expect(normalizeReactionEmoji("👍")).toBe("👍");
    expect(normalizeReactionEmoji("👍🏽")).toBe("👍🏽");
    expect(normalizeReactionEmoji("👨‍👩‍👧")).toBe("👨‍👩‍👧");
    expect(normalizeReactionEmoji(":party_parrot:")).toBe(":party_parrot:");
    // ✌ + skin tone: no selector before a modifier; keycap #️⃣ keeps its selector.
    expect(normalizeReactionEmoji(`${char(0x270c)}${char(0x1f3fb)}`)).toBe(`${char(0x270c)}${char(0x1f3fb)}`);
    expect(normalizeReactionEmoji(`#${char(0x20e3)}`)).toBe(`#${VS16}${char(0x20e3)}`);
  });
});
