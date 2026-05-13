// Next.js Route Handler 用の認可ヘルパ。
// `next/headers` の cookies() と Web Standard Request を扱うので、
// Socket.io 側からは import しないこと（`room-auth.ts` の Cookie ヘッダ系を使う）。

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { passcodeCookieName } from "./room-auth";

export async function readPasscodeCookie(slug: string): Promise<string | undefined> {
  const store = await cookies();
  return store.get(passcodeCookieName(slug))?.value;
}

// 鍵ありルームの場合のみ Cookie 一致を要求する。
// 鍵なし（roomPasscode === null）は誰でも操作可で true を返す。
// 「鍵なし→鍵あり初回設定だけは誰でも可」のような特殊ルールは呼び出し側で組む。
export async function isAuthorizedForRoom(
  slug: string,
  roomPasscode: string | null,
): Promise<boolean> {
  if (!roomPasscode) return true;
  const cookieValue = await readPasscodeCookie(slug);
  return cookieValue === roomPasscode;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbiddenResponse() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// 状態変更リクエストの CSRF 防御。
// - GET/HEAD/OPTIONS は常に許可
// - Origin / Referer のいずれかが「許可オリジン」と一致すれば許可
// - 両方欠落 / 両方とも不一致 → 拒否
//
// 許可オリジンは以下の和集合：
//   - env `ALLOWED_ORIGINS`（カンマ区切り、例: "https://app.example.com,https://staging.example.com"）
//   - リクエストの Host ヘッダ自身（http/https 両方を許可）
//
// Host ヘッダを混ぜているのは「ローカル開発（127.0.0.1:3000）と本番（https://...）」の双方を
// env なしで通すため。逆プロキシで Host を信頼している前提（Forwarded-Host 等を尊重するなら別途調整）。
export function isSameOriginRequest(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const refOrigin = parseOrigin(referer);
  const candidates = [origin, refOrigin].filter((v): v is string => Boolean(v));
  if (candidates.length === 0) return false;

  const allowed = collectAllowedOrigins(req);
  return candidates.every((o) => allowed.has(o));
}

function parseOrigin(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function collectAllowedOrigins(req: Request): Set<string> {
  const out = new Set<string>();
  const env = process.env.ALLOWED_ORIGINS;
  if (env) {
    for (const raw of env.split(",")) {
      const trimmed = raw.trim();
      if (trimmed) out.add(trimmed);
    }
  }
  const host = hostFromRequest(req);
  if (host) {
    out.add(`http://${host}`);
    out.add(`https://${host}`);
  }
  return out;
}

function hostFromRequest(req: Request): string | null {
  const headerHost = req.headers.get("host");
  if (headerHost) return headerHost;
  try {
    return new URL(req.url).host;
  } catch {
    return null;
  }
}
