import { describe, expect, it } from "vitest";

import { AppError } from "../../lib/app-error.js";
import type { QuerySql } from "../../lib/db-types.js";
import { assertUploadQuota, knowledgeUploadQuota } from "./attachments.service.js";
import { assertCommentQuota, knowledgeCommentQuota } from "./comments.service.js";

/**
 * Per-person quotas of the knowledge base (KB-SEC-02 / KB-SEC-03): upload tickets (rate + files never posted) and
 * comments. A fake tagged-template `sql` answers the one counting query and records it.
 */
const fakeSql = (row: Record<string, number>) => {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("$").replace(/\s+/g, " ").trim(), values });
    return Promise.resolve([row]);
  };
  return { sql: sql as unknown as QuerySql, calls };
};

const outcome = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof AppError ? `${error.statusCode} ${error.code}` : "other";
  }
};

const me = "22222222-2222-4222-8222-222222222222";

describe("upload quota", () => {
  it("allows uploads under both limits", async () => {
    const { sql, calls } = fakeSql({ minute: knowledgeUploadQuota.perMinute - 1, unsent: knowledgeUploadQuota.unsentPerHour - 1 });
    expect(await outcome(assertUploadQuota(sql, me))).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.values).toContain(me);
  });

  it("refuses a burst of tickets", async () => {
    const { sql } = fakeSql({ minute: knowledgeUploadQuota.perMinute, unsent: 0 });
    expect(await outcome(assertUploadQuota(sql, me))).toBe("429 ATTACHMENT_RATE_LIMITED");
  });

  it("counts completed comment files that were never posted, not only pending uploads", async () => {
    const { sql, calls } = fakeSql({ minute: 0, unsent: knowledgeUploadQuota.unsentPerHour });
    expect(await outcome(assertUploadQuota(sql, me))).toBe("429 ATTACHMENT_RATE_LIMITED");
    const text = calls[0]!.text;
    expect(text).toContain("a.status = 'pending' OR (a.purpose = 'comment' AND a.comment_id IS NULL)");
    expect(text).toContain("a.deleted_at IS NULL");
    expect(text).toContain("interval '1 hour'");
  });
});

describe("comment quota", () => {
  it("allows comments under the limit and refuses the next one", async () => {
    expect(await outcome(assertCommentQuota(fakeSql({ count: knowledgeCommentQuota.perMinute - 1 }).sql, me))).toBeNull();
    const { sql, calls } = fakeSql({ count: knowledgeCommentQuota.perMinute });
    expect(await outcome(assertCommentQuota(sql, me))).toBe("429 KNOWLEDGE_RATE_LIMITED");
    expect(calls[0]!.text).toContain("interval '1 minute'");
    expect(calls[0]!.values).toEqual([me]);
  });
});
