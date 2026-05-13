import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { RoomPasscodeSchema } from "@/lib/passcode";
import { buildClearPasscodeCookie, buildSetPasscodeCookie } from "@/lib/room-auth";
import { forbiddenResponse, isSameOriginRequest } from "@/lib/room-auth-server";
import {
  checkAuthRateLimit,
  clearAuthRateLimit,
  clientIpFromRequest,
  recordAuthFailure,
} from "@/lib/rate-limit";

const AuthSchema = z.object({
  passcode: RoomPasscodeSchema,
});

// passcode の比較はタイミング攻撃緩和のため `crypto.timingSafeEqual` を使う。
// 文字列の `===` 比較は文字単位で短絡評価されるため、応答時間から正解の頭文字が
// 推定できてしまう。長さ不一致は早期 return（その場合はそもそも長さで弾けるので問題なし）。
function passcodesMatch(submitted: string, stored: string): boolean {
  const a = Buffer.from(submitted);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function tooManyAttemptsResponse(retryAfterSec: number): NextResponse {
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
  return NextResponse.json(
    { error: `試行回数が多すぎます。${minutes} 分後にやり直してください。` },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSec) },
    },
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isSameOriginRequest(req)) return forbiddenResponse();
  const { slug } = await params;
  const body = await req.json().catch(() => null);
  const parsed = AuthSchema.safeParse(body);
  // 400（フォーマット違反）はレートリミットの対象外。意味のないブルートフォースに使えないため、
  // 正規ユーザーが SMS 改行混入等で誤フォーマットを送ったときに巻き込まないことを優先。
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // IP が取れない（dev 環境やテスト）場合はレートリミット自体を skip する。
  // 本番は逆プロキシの `x-forwarded-for` を必ず立てる前提。
  const ip = clientIpFromRequest(req);
  const rateKey = ip ? `${ip}:${slug}` : null;

  if (rateKey) {
    const check = checkAuthRateLimit(rateKey);
    if (!check.ok) return tooManyAttemptsResponse(check.retryAfterSec);
  }

  const room = await prisma.room.findUnique({ where: { slug } });
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  if (!room.passcode) {
    return NextResponse.json({ error: "Room has no passcode" }, { status: 400 });
  }

  if (!passcodesMatch(parsed.data.passcode, room.passcode)) {
    if (rateKey) {
      const result = recordAuthFailure(rateKey);
      if (!result.ok) return tooManyAttemptsResponse(result.retryAfterSec);
    }
    return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
  }

  // 成功時はカウンタを即時リセット（5 回連続ミスして 6 回目正解、のケースで次回以降 5 回まで猶予）。
  if (rateKey) clearAuthRateLimit(rateKey);

  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", buildSetPasscodeCookie(slug, room.passcode));
  return res;
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isSameOriginRequest(req)) return forbiddenResponse();
  const { slug } = await params;
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", buildClearPasscodeCookie(slug));
  return res;
}
