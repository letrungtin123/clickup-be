import "dotenv/config";

import { z } from "zod";

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
    SUPABASE_ANON_KEY: z.string().min(1).optional(),
    SUPABASE_JWT_SECRET: z.string().min(32).optional(),
    SUPABASE_JWT_ISSUER: z.string().url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    STORAGE_BUCKET: z.string().min(3).max(63).default("nesso-work-files"),
    AUTH_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    REDIS_URL: z.string().url().optional(),
    RABBITMQ_URL: z.string().url().optional(),
    ACCESS_CONTEXT_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).default(60)
  })
  .superRefine((value, context) => {
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

export const authCookieSecure = env.AUTH_COOKIE_SECURE
  ? env.AUTH_COOKIE_SECURE === "true"
  : env.NODE_ENV === "production";
