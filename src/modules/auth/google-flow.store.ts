import { z } from "zod";

import { AppError } from "../../lib/app-error.js";
import { getOptionalRedis } from "../../lib/redis.js";
import { googleFlowKey } from "./google-oauth.js";

/** A pending Google sign-in lives this long (also the state cookie's lifetime). */
export const googleFlowTtlSeconds = 600;

const GoogleFlowSchema = z.object({
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  next: z.string().startsWith("/").max(2048)
});
export type GoogleFlow = z.infer<typeof GoogleFlowSchema>;

const requireRedis = () => {
  const redis = getOptionalRedis();
  if (!redis) {
    throw new AppError("AUTH_NOT_CONFIGURED", "Google sign-in needs Redis.", 503);
  }
  return redis;
};

/** Stores the PKCE verifier server side; the browser only ever holds the opaque state. */
export const saveGoogleFlow = async (state: string, flow: GoogleFlow) => {
  const stored = await requireRedis().set(
    googleFlowKey(state),
    JSON.stringify(GoogleFlowSchema.parse(flow)),
    "EX",
    googleFlowTtlSeconds,
    "NX"
  );
  if (stored !== "OK") {
    throw new AppError("AUTH_PROVIDER_ERROR", "Google sign-in could not be started.", 503);
  }
};

/** Single use: the flow is deleted atomically as it is read (a replayed callback finds nothing). */
export const takeGoogleFlow = async (state: string): Promise<GoogleFlow | null> => {
  const raw = await requireRedis().getdel(googleFlowKey(state));
  if (!raw) {
    return null;
  }
  try {
    const parsed = GoogleFlowSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
