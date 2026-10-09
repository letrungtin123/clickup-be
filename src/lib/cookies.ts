import type { Request } from "express";

export const readCookie = (req: Pick<Request, "header">, name: string) => {
  return readCookieFromHeader(req.header("cookie"), name);
};

export const readCookieFromHeader = (header: string | undefined | null, name: string) => {
  if (!header) {
    return null;
  }

  const cookies = header.split(";");
  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = cookie.slice(0, separatorIndex).trim();
    if (key !== name) {
      continue;
    }

    const rawValue = cookie.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
};
