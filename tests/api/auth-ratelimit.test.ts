import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// 閾値を 3 回失敗で 60 秒ウィンドウ・120 秒ロックに縮めて高速にテスト。
vi.mock("@/lib/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/constants")>();
  return {
    ...actual,
    AUTH_RATE_LIMIT_MAX: 3,
    AUTH_RATE_LIMIT_WINDOW_SEC: 60,
    AUTH_RATE_LIMIT_LOCK_SEC: 120,
  };
});

import { POST } from "@/app/api/rooms/[slug]/auth/route";
import { __resetAuthRateLimitForTest } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "../helpers/db";
import { jsonRequest, paramsOf, readJson } from "../helpers/requests";

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  __resetAuthRateLimitForTest();
  await prisma.room.create({ data: { name: "rl", slug: "rl-001", passcode: "A1B2C3" } });
});

afterEach(() => {
  __resetAuthRateLimitForTest();
});

function attempt(passcode: string, ip: string | undefined = "1.2.3.4") {
  return POST(
    jsonRequest("http://localhost/api/rooms/rl-001/auth", {
      method: "POST",
      body: { passcode },
      ip,
    }),
    paramsOf({ slug: "rl-001" }),
  );
}

describe("POST /api/rooms/[slug]/auth レートリミット", () => {
  it("MAX 回（=3）の 401 が連続したら次回は 429 + Retry-After ヘッダ", async () => {
    expect((await attempt("ZZZZZZ")).status).toBe(401);
    expect((await attempt("ZZZZZZ")).status).toBe(401);
    expect((await attempt("ZZZZZZ")).status).toBe(429);

    const next = await attempt("A1B2C3"); // 正解を送ってもロック中なので 429
    expect(next.status).toBe(429);
    expect(next.headers.get("Retry-After")).toBeTruthy();
    const retryAfter = Number(next.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(120);

    const data = await readJson<{ error: string }>(next);
    expect(data.error).toContain("試行回数");
  });

  it("成功するとカウンタがリセットされる（5 回目で正解 → 次から再び 5 回猶予）", async () => {
    expect((await attempt("ZZZZZZ")).status).toBe(401);
    expect((await attempt("ZZZZZZ")).status).toBe(401);
    // 3 回目は正解で成功
    const ok = await attempt("A1B2C3");
    expect(ok.status).toBe(200);

    // 続けてまた 2 回失敗してもロックされない
    expect((await attempt("ZZZZZZ")).status).toBe(401);
    expect((await attempt("ZZZZZZ")).status).toBe(401);
    expect((await attempt("ZZZZZZ")).status).toBe(429); // 3 回目でロック
  });

  it("400（フォーマット違反）はカウントされない", async () => {
    // フォーマット不正 → 400 を 5 連発しても以降の 401 でロックされない
    for (let i = 0; i < 5; i++) {
      const res = await POST(
        jsonRequest("http://localhost/api/rooms/rl-001/auth", {
          method: "POST",
          body: { passcode: "abc" },
          ip: "1.2.3.4",
        }),
        paramsOf({ slug: "rl-001" }),
      );
      expect(res.status).toBe(400);
    }
    expect((await attempt("ZZZZZZ")).status).toBe(401);
    expect((await attempt("ZZZZZZ")).status).toBe(401);
    expect((await attempt("ZZZZZZ")).status).toBe(429);
  });

  it("別 IP は独立してカウントされる（NAT 共有環境で他人を巻き込まない）", async () => {
    // IP A から 3 回失敗してロック
    expect((await attempt("ZZZZZZ", "1.1.1.1")).status).toBe(401);
    expect((await attempt("ZZZZZZ", "1.1.1.1")).status).toBe(401);
    expect((await attempt("ZZZZZZ", "1.1.1.1")).status).toBe(429);
    // IP B からは影響なく試行できる
    expect((await attempt("ZZZZZZ", "2.2.2.2")).status).toBe(401);
    expect((await attempt("A1B2C3", "2.2.2.2")).status).toBe(200);
  });

  it("別 slug は独立してカウントされる（同一 IP で別ルームに進める）", async () => {
    await prisma.room.create({ data: { name: "rl2", slug: "rl-002", passcode: "X9Y8Z7" } });

    expect((await attempt("ZZZZZZ", "1.2.3.4")).status).toBe(401);
    expect((await attempt("ZZZZZZ", "1.2.3.4")).status).toBe(401);
    expect((await attempt("ZZZZZZ", "1.2.3.4")).status).toBe(429);

    // 同じ IP でも別 slug はカウンタが独立
    const otherRoom = await POST(
      jsonRequest("http://localhost/api/rooms/rl-002/auth", {
        method: "POST",
        body: { passcode: "X9Y8Z7" },
        ip: "1.2.3.4",
      }),
      paramsOf({ slug: "rl-002" }),
    );
    expect(otherRoom.status).toBe(200);
  });

  it("IP が取れない（ヘッダ未設定）リクエストはレートリミットを skip する", async () => {
    // ip パラメータを渡さない → x-forwarded-for 不在 → カウンタが回らない
    for (let i = 0; i < 10; i++) {
      const res = await POST(
        jsonRequest("http://localhost/api/rooms/rl-001/auth", {
          method: "POST",
          body: { passcode: "ZZZZZZ" },
        }),
        paramsOf({ slug: "rl-001" }),
      );
      expect(res.status).toBe(401);
    }
  });
});
