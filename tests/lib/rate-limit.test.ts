import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 閾値を小さくして高速にテストするため constants をモック差し替え。
// 実本番値は constants.ts の env 経由（5/300/900）。
vi.mock("@/lib/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/constants")>();
  return {
    ...actual,
    AUTH_RATE_LIMIT_MAX: 3,
    AUTH_RATE_LIMIT_WINDOW_SEC: 60,
    AUTH_RATE_LIMIT_LOCK_SEC: 120,
  };
});

import {
  __resetAuthRateLimitForTest,
  checkAuthRateLimit,
  clearAuthRateLimit,
  clientIpFromRequest,
  recordAuthFailure,
} from "@/lib/rate-limit";

beforeEach(() => {
  __resetAuthRateLimitForTest();
});

afterEach(() => {
  __resetAuthRateLimitForTest();
});

describe("checkAuthRateLimit / recordAuthFailure", () => {
  const KEY = "1.2.3.4:room-001";

  it("初回チェックは ok: true（バケツが無い）", () => {
    expect(checkAuthRateLimit(KEY)).toEqual({ ok: true });
  });

  it("MAX 未満の失敗ではロックされない", () => {
    const t = 1_000_000;
    expect(recordAuthFailure(KEY, t)).toEqual({ ok: true });
    expect(recordAuthFailure(KEY, t + 100)).toEqual({ ok: true });
    expect(checkAuthRateLimit(KEY, t + 200)).toEqual({ ok: true });
  });

  it("MAX 回失敗するとロックされ、次回 check で ok: false + retryAfterSec が返る", () => {
    const t = 1_000_000;
    recordAuthFailure(KEY, t);
    recordAuthFailure(KEY, t + 100);
    const last = recordAuthFailure(KEY, t + 200);
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.retryAfterSec).toBe(120);

    const after = checkAuthRateLimit(KEY, t + 300);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.retryAfterSec).toBeGreaterThan(0);
  });

  it("ロック時間を過ぎたら自動的に解放される", () => {
    const t = 1_000_000;
    recordAuthFailure(KEY, t);
    recordAuthFailure(KEY, t);
    recordAuthFailure(KEY, t);
    expect(checkAuthRateLimit(KEY, t + 119_000).ok).toBe(false);
    // ちょうど境界（120 秒経過）以降は ok。
    expect(checkAuthRateLimit(KEY, t + 121_000)).toEqual({ ok: true });
  });

  it("ロック中の追加失敗では lockedUntil が延長されない（タイマー延長攻撃防止）", () => {
    const t = 1_000_000;
    recordAuthFailure(KEY, t);
    recordAuthFailure(KEY, t);
    recordAuthFailure(KEY, t);
    // ロック中に追加で失敗を打ち込む
    const extra = recordAuthFailure(KEY, t + 60_000);
    expect(extra.ok).toBe(false);
    // lock 開始は t、解除予定は t+120s。t+121s には解放されているはず。
    expect(checkAuthRateLimit(KEY, t + 121_000).ok).toBe(true);
  });

  it("ウィンドウを超えた場合、失敗カウントがリセットされる", () => {
    const t = 1_000_000;
    recordAuthFailure(KEY, t);
    recordAuthFailure(KEY, t + 1_000);
    // ウィンドウ (60s) を超えてから失敗 → カウンタはリセットされ、ロックされない
    const result = recordAuthFailure(KEY, t + 61_000);
    expect(result).toEqual({ ok: true });
    expect(checkAuthRateLimit(KEY, t + 62_000)).toEqual({ ok: true });
  });

  it("clearAuthRateLimit で即座にカウンタが消える", () => {
    const t = 1_000_000;
    recordAuthFailure(KEY, t);
    recordAuthFailure(KEY, t);
    clearAuthRateLimit(KEY);
    // 次の失敗は「初回」扱いに戻る
    expect(recordAuthFailure(KEY, t + 1)).toEqual({ ok: true });
  });

  it("別 key は独立してカウントされる（同一 IP・別 slug を巻き込まない）", () => {
    const t = 1_000_000;
    recordAuthFailure("1.2.3.4:room-A", t);
    recordAuthFailure("1.2.3.4:room-A", t);
    recordAuthFailure("1.2.3.4:room-A", t);
    // room-A はロック中
    expect(checkAuthRateLimit("1.2.3.4:room-A", t + 100).ok).toBe(false);
    // room-B は影響なし
    expect(checkAuthRateLimit("1.2.3.4:room-B", t + 100)).toEqual({ ok: true });
  });
});

describe("clientIpFromRequest", () => {
  function req(headers: Record<string, string>): Request {
    return new Request("http://localhost/x", { headers: new Headers(headers) });
  }

  it("x-forwarded-for の最初の値を返す", () => {
    expect(clientIpFromRequest(req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("x-forwarded-for が無ければ x-real-ip にフォールバック", () => {
    expect(clientIpFromRequest(req({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("どちらも無ければ null", () => {
    expect(clientIpFromRequest(req({}))).toBeNull();
  });

  it("x-forwarded-for が空文字なら x-real-ip を見る", () => {
    expect(
      clientIpFromRequest(req({ "x-forwarded-for": "", "x-real-ip": "9.9.9.9" })),
    ).toBe("9.9.9.9");
  });
});
