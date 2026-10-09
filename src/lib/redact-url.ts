/** Query parameters whose values must never reach the logs (OAuth codes/state, tokens). */
const sensitiveParams = new Set(["code", "state", "access_token", "refresh_token", "token", "code_verifier"]);

/** Request URL for logging with sensitive query values replaced by "REDACTED". */
export const redactUrl = (url: string) => {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) {
    return url;
  }
  const hashStart = url.indexOf("#", queryStart);
  const query = url.slice(queryStart + 1, hashStart === -1 ? undefined : hashStart);
  const redacted = query
    .split("&")
    .map((pair) => {
      const separator = pair.indexOf("=");
      const rawKey = separator === -1 ? pair : pair.slice(0, separator);
      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      } catch {
        // keep the raw key
      }
      return sensitiveParams.has(key.toLowerCase()) && separator !== -1 ? `${rawKey}=REDACTED` : pair;
    })
    .join("&");
  return `${url.slice(0, queryStart)}?${redacted}${hashStart === -1 ? "" : url.slice(hashStart)}`;
};
