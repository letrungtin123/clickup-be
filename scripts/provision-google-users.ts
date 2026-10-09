/**
 * Google sign-in (PD-012) backfill. GoTrue runs with DISABLE_SIGNUP=true, which also refuses brand-new
 * OAuth users, so every whitelisted e-mail (public.allowed_emails) needs a GoTrue user before its first
 * Google sign-in. New whitelist entries are provisioned automatically while GOOGLE_AUTH_ENABLED=true;
 * run this once when enabling the feature (and any time to retry failures). Idempotent; prints counts only.
 *
 *   cd BE && npx tsx scripts/provision-google-users.ts
 *
 * See docs/architecture/google-login.md.
 */
import { closeDatabase, getSql } from "../src/db/client.js";
import { closeRedis } from "../src/lib/redis.js";
import { provisionGoogleAuthUsers } from "../src/modules/auth/google-auth.service.js";

const main = async () => {
  const rows = await getSql()<{ email: string }[]>`SELECT DISTINCT email FROM public.allowed_emails ORDER BY email`;
  const summary = await provisionGoogleAuthUsers(rows.map((row) => row.email));
  console.log(
    `Whitelisted e-mails: ${rows.length}; GoTrue users created: ${summary.created}; already present: ${summary.existing}; failed: ${summary.failed}`
  );
  return summary.failed === 0;
};

main()
  .then(async (ok) => {
    await closeDatabase();
    await closeRedis();
    process.exit(ok ? 0 : 1);
  })
  .catch(async (error: unknown) => {
    console.error("Provisioning failed:", error instanceof Error ? error.message : "unknown error");
    await closeDatabase();
    await closeRedis();
    process.exit(1);
  });
