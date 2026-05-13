// プロセス内 Map ベースの単純なレートリミッタ。
//
// 用途は `POST /api/rooms/[slug]/auth` のブルートフォース緩和。
// key は呼び出し側で組み立てる（典型的には `${ip}:${slug}`）。
//
// 仕様:
// - `recordFailure(key)` を呼ぶたびに失敗カウンタをインクリメント
// - `WINDOW` 秒以内に `MAX` 回連続失敗するとロック状態になり、`LOCK` 秒間 `check(key)` が `ok: false` を返す
// - ロック中の追加失敗は新規ロックを上書きしない（タイマー延長攻撃を避けるため）
// - 成功時は `clear(key)` を呼んで即座に解放
// - WINDOW を過ぎた最古失敗は自動失効（ウィンドウは「最初の失敗からのスライド」ではなく「リセット型」）
//
// 制約:
// - プロセス内 Map なので複数インスタンス化したら破綻する（OK 前提: docs/architecture.md §6）
// - メモリ DoS 緩和のため `MAX_BUCKETS` を超えたら一番古いエントリを FIFO で捨てる
//   （Map の挿入順は ES2015 で保証されているのでこれが成立）

import {
  AUTH_RATE_LIMIT_LOCK_SEC,
  AUTH_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_WINDOW_SEC,
} from "./constants";

type Bucket = {
  failures: number;
  // ウィンドウ判定用。ウィンドウ過ぎたら作り直す。
  firstFailureAt: number;
  // ロック中なら解除予定の epoch ms。null ならロック中ではない。
  lockedUntil: number | null;
};

const buckets = new Map<string, Bucket>();

// メモリ DoS 対策の保険。10000 IP+slug 同時にカウント中は現実的にあり得ないが念のため。
const MAX_BUCKETS = 10_000;

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number };

// 現在ロック中なら拒否、それ以外は通す（ここではカウンタを動かさない）。
// ウィンドウ超過したエントリは lazy に削除する（次の sweep を不要にする）。
export function checkAuthRateLimit(key: string, now: number = Date.now()): RateLimitResult {
  const b = buckets.get(key);
  if (!b) return { ok: true };

  if (b.lockedUntil !== null) {
    if (b.lockedUntil > now) {
      return { ok: false, retryAfterSec: Math.ceil((b.lockedUntil - now) / 1000) };
    }
    // ロック明け。エントリを掃除して通す。
    buckets.delete(key);
    return { ok: true };
  }

  // ロック中ではないが、最初の失敗からウィンドウを超えていればリセット扱い。
  if (b.firstFailureAt + AUTH_RATE_LIMIT_WINDOW_SEC * 1000 <= now) {
    buckets.delete(key);
  }
  return { ok: true };
}

// 失敗を 1 つ記録する。返り値は「この記録の結果ロックされたか」を示す。
// 401 を返す前にこれを呼ぶ運用で、次回以降の check で 429 を返す。
export function recordAuthFailure(key: string, now: number = Date.now()): RateLimitResult {
  let b = buckets.get(key);

  // ロック中の追加失敗は無視（タイマー延長攻撃を避けるため lockedUntil を伸ばさない）。
  if (b && b.lockedUntil !== null && b.lockedUntil > now) {
    return { ok: false, retryAfterSec: Math.ceil((b.lockedUntil - now) / 1000) };
  }

  // ウィンドウ超過 or 初回ならバケツを作り直す。
  if (!b || b.firstFailureAt + AUTH_RATE_LIMIT_WINDOW_SEC * 1000 <= now) {
    b = { failures: 0, firstFailureAt: now, lockedUntil: null };
  }

  b.failures += 1;
  if (b.failures >= AUTH_RATE_LIMIT_MAX) {
    b.lockedUntil = now + AUTH_RATE_LIMIT_LOCK_SEC * 1000;
  }
  buckets.set(key, b);

  // FIFO で上限超過分を捨てる。
  while (buckets.size > MAX_BUCKETS) {
    const firstKey = buckets.keys().next().value as string | undefined;
    if (firstKey === undefined || firstKey === key) break;
    buckets.delete(firstKey);
  }

  if (b.lockedUntil !== null) {
    return { ok: false, retryAfterSec: AUTH_RATE_LIMIT_LOCK_SEC };
  }
  return { ok: true };
}

export function clearAuthRateLimit(key: string) {
  buckets.delete(key);
}

// テスト用: バケツを全消し。プロセス内 Map なのでテスト間で漏れる。
export function __resetAuthRateLimitForTest() {
  buckets.clear();
}

// `x-forwarded-for` を最優先（リバプロ前提）、なければ `x-real-ip`。
// どちらも無ければ null（dev 環境ではレートリミットを skip する想定）。
// XFF はカンマ区切りでチェーンになるので最初の値だけ取る（最も外側のクライアント IP）。
export function clientIpFromRequest(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  return real?.trim() || null;
}
