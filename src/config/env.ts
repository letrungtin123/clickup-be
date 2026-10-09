import "dotenv/config";

import { z } from "zod";

/** Optional string setting; a blank value (`SMTP_HOST=`) counts as unset. */
const optionalText = () =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.string().trim().min(1).optional());

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    API_HOST: z.string().min(1).default("127.0.0.1"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3890),
    WEB_ORIGIN: z.string().url().default("http://127.0.0.1:5890"),
    ADDITIONAL_CORS_ORIGINS: z.string().default(""),
    DATABASE_URL: z.string().url().optional(),
    DATABASE_SSL: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    SUPABASE_URL: z.string().url().default("http://127.0.0.1:56321"),
    /**
     * Origin browsers use for signed storage URLs. Unset: URLs are same-origin paths (/storage/v1/...)
     * that the web server proxies to storage, so any LAN/host name of the web app works.
     */
    STORAGE_PUBLIC_URL: z.string().url().optional(),
    SUPABASE_ANON_KEY: z.string().min(1).optional(),
    SUPABASE_JWT_SECRET: z.string().min(32).optional(),
    SUPABASE_JWT_ISSUER: z.string().url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    STORAGE_BUCKET: z.string().min(3).max(63).default("nesso-work-files"),
    AUTH_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    /** Failed sign-ins per account (any IP) before a temporary lockout. */
    LOGIN_ACCOUNT_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
    /** Reverse-proxy hops in front of the API whose X-Forwarded-For is trusted. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    REDIS_URL: z.string().url().optional(),
    RABBITMQ_URL: z.string().url().optional(),
    ACCESS_CONTEXT_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
    /**
     * E-mail delivery of notifications (PD-013). Active only when SMTP_HOST and SMTP_FROM are set.
     * SMTP_HOST=log renders mails into the worker log instead of sending them (development).
     */
    SMTP_HOST: optionalText(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    /** Implicit TLS (port 465). Unset: true only for port 465; 587 upgrades with STARTTLS. */
    SMTP_SECURE: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === "true")),
    SMTP_USER: optionalText(),
    SMTP_PASS: optionalText(),
    /** Sender, e.g. `Nesso Work <no-reply@example.com>` (Gmail: the authenticated address or a verified alias). */
    SMTP_FROM: optionalText(),
    /** Base URL of the web app used for links in e-mails. Defaults to WEB_ORIGIN. */
    APP_PUBLIC_URL: z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional()),
    /** Digest window (PD-013 / SPEC §6): at most one e-mail per user per this many minutes. */
    EMAIL_DIGEST_MINUTES: z.coerce.number().int().min(1).max(1440).default(5),
    /**
     * "Đăng nhập bằng Google" (PD-012). Off unless "true"; GoTrue must also have the Google provider
     * enabled (docs/architecture/google-login.md). Only `allowed_emails` entries may sign in.
     */
    GOOGLE_AUTH_ENABLED: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z
        .enum(["true", "false"])
        .default("false")
        .transform((value) => value === "true")
    ),
    /** Browser-facing Supabase origin used for GoTrue's /auth/v1/authorize redirect. Defaults to SUPABASE_URL. */
    SUPABASE_PUBLIC_URL: z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional()),
    /** Optional comma-separated Google Workspace domains (`hd` claim); empty = any verified Google account. */
    GOOGLE_AUTH_HOSTED_DOMAINS: z.string().default(""),
    /** Google sign-in redirects (start + callback) per client address per 15 minutes. */
    GOOGLE_AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60)
  })
  .superRefine((value, context) => {
    if (value.GOOGLE_AUTH_ENABLED) {
      // State lives in Redis, the code exchange needs the anon key, provisioning needs the DB + admin API.
      for (const key of ["DATABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "REDIS_URL"] as const) {
        if (!value[key]) {
          context.addIssue({ code: "custom", path: [key], message: `${key} is required when GOOGLE_AUTH_ENABLED=true` });
        }
      }
      if (value.NODE_ENV === "production") {
        // Google only accepts HTTPS redirect URIs (localhost aside); the state cookie must be Secure.
        for (const key of ["SUPABASE_PUBLIC_URL", "APP_PUBLIC_URL"] as const) {
          if (!value[key]?.startsWith("https://")) {
            context.addIssue({
              code: "custom",
              path: [key],
              message: `${key} must be an https:// URL when GOOGLE_AUTH_ENABLED=true in production`
            });
          }
        }
      }
    }

    if (value.NODE_ENV === "production") {
      if (!value.DATABASE_URL) {
        context.addIssue({
          code: "custom",
          path: ["DATABASE_URL"],
          message: "DATABASE_URL is required in production"
        });
      }

      const requiredInProduction = [
        "SUPABASE_ANON_KEY",
        "SUPABASE_JWT_SECRET",
        "SUPABASE_JWT_ISSUER",
        "SUPABASE_SERVICE_ROLE_KEY",
        "REDIS_URL",
        "RABBITMQ_URL"
      ] as const;

      for (const key of requiredInProduction) {
        if (!value[key]) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required in production`
          });
        }
      }
    }
  });

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const message = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid API environment: ${message}`);
}

export const env = parsed.data;

export const corsOrigins = [
  env.WEB_ORIGIN,
  ...env.ADDITIONAL_CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
];

/** Origin (+ optional base path) of the web app, without a trailing slash; links in e-mails start here. */
export const appPublicUrl = (env.APP_PUBLIC_URL ?? env.WEB_ORIGIN).replace(/\/+$/, "");

/** Browser-facing Supabase origin (OAuth redirects), without a trailing slash. */
export const supabasePublicUrl = (env.SUPABASE_PUBLIC_URL ?? env.SUPABASE_URL).replace(/\/+$/, "");

export const authCookieSecure = env.AUTH_COOKIE_SECURE
  ? env.AUTH_COOKIE_SECURE === "true"
  : env.NODE_ENV === "production";
