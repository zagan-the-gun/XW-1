export const PASSCODE_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30;

export function passcodeCookieName(slug: string) {
  return `xw_passcode_${slug}`;
}

// HTTPS 終端配下でのみ Secure 属性を付ける。
// `COOKIE_SECURE` で明示優先、未指定時は NODE_ENV=production を真値として扱う。
// 開発環境（http://localhost）で Secure を付けるとブラウザに保存されないため必ず外す。
function isSecureCookieEnv(): boolean {
  const explicit = process.env.COOKIE_SECURE;
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return process.env.NODE_ENV === "production";
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
  if (isSecureCookieEnv()) attrs.push("Secure");
  return attrs.join("; ");
}

export function buildClearPasscodeCookie(slug: string) {
  const name = passcodeCookieName(slug);
  const attrs = [`${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isSecureCookieEnv()) attrs.push("Secure");
  return attrs.join("; ");
}
