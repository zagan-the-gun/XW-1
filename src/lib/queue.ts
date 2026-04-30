import type { Track } from "@prisma/client";

/**
 * 新しい曲がキュー末尾に append された直後の `currentIndex` を決める。
 *
 * - 既に再生中 (`prevIndex >= 0`) のときは何もしない。
 * - アイドル状態 (`prevIndex < 0`) のときは:
 *   - キュー内に `QUEUED` が残っていればそれを再生する
 *   - 全曲消化済み (全て `PLAYED`/`SKIPPED`) や初期空キューの場合は、
 *     追加されたばかりの曲 (= 末尾) を再生する
 *
 * 重要: フォールバックで `0` を返してしまうと、ループOFF で全曲消化後に
 * 曲を追加した瞬間「先頭の PLAYED 曲」が巻き戻し再生される不具合になる。
 * 必ず追加後の末尾 index (= `prevTracks.length`) を返すこと。
 */
export function pickIndexAfterAdd(prevIndex: number, prevTracks: Track[]): number {
  if (prevIndex >= 0) return prevIndex;
  const idx = prevTracks.findIndex((t) => t.status === "QUEUED");
  if (idx >= 0) return idx;
  return prevTracks.length;
}

/**
 * `currentIndex` 以降で次に再生すべきトラックの index を返す。
 * 見つからなければ `-1`。
 */
export function findNextQueued(tracks: Track[], currentIndex: number): number {
  for (let i = currentIndex + 1; i < tracks.length; i++) {
    if (tracks[i].status === "QUEUED" || tracks[i].status === "PLAYING") return i;
  }
  return -1;
}

/**
 * シャッフル再生用: QUEUED (および PLAYING) の中からランダムに 1 件 index を返す。
 * 候補が無ければ `-1`。
 *
 * `excludeId` を渡すと、その曲は候補から除外される。これは「ループON+シャッフルで
 * 全消化 → reset → 直後に同じ曲が再生される」のがっかり感を避けるための仕様。
 * ただし除外した結果候補が 0 件になるケース（曲が 1 つしかない room 等）では、
 * 除外を無視してフォールバックする（無音停止より連続再生のほうが望ましいため）。
 */
export function pickRandomQueued(
  tracks: Track[],
  options?: { excludeId?: string },
): number {
  const candidates: number[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.status !== "QUEUED" && t.status !== "PLAYING") continue;
    if (options?.excludeId && t.id === options.excludeId) continue;
    candidates.push(i);
  }
  if (candidates.length === 0 && options?.excludeId) {
    return pickRandomQueued(tracks);
  }
  if (candidates.length === 0) return -1;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
