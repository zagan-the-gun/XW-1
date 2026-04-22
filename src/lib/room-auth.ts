export const PASSCODE_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30;

export function passcodeCookieName(slug: string) {
  return `xw_passcode_${slug}`;
}

// Socket.io の handshake.headers.cookie をパースするため自前で用意。
// next/headers の cookies() は API Route / SSR では使えるが Socket 側では使えない。
export function parseCookieHeader(header: string | undefined | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function verifyPasscodeFromCookieHeader(
  slug: string,
  cookieHeader: string | undefined | null,
  roomPasscode: string | null,
): boolean {
  if (!roomPasscode) return true;
  const cookies = parseCookieHeader(cookieHeader);
  return cookies[passcodeCookieName(slug)] === roomPasscode;
}

export function buildSetPasscodeCookie(slug: string, passcode: string) {
  const name = passcodeCookieName(slug);
  const attrs = [
    `${name}=${encodeURIComponent(passcode)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${PASSCODE_COOKIE_MAX_AGE_SEC}`,
  ];
  return attrs.join("; ");
}

export function buildClearPasscodeCookie(slug: string) {
  const name = passcodeCookieName(slug);
  return [`${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"].join("; ");
}
