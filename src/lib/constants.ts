export const MAX_TRACKS_PER_ROOM = 1000;

// 参加者 0 人状態が続いたルームを自動削除するまでの日数。
// env `ROOM_INACTIVITY_TTL_DAYS` で上書き可能（例: 将来的に 30 → 7 日に短縮する想定）。
export const ROOM_INACTIVITY_TTL_DAYS = (() => {
  const raw = process.env.ROOM_INACTIVITY_TTL_DAYS;
  if (!raw) return 30;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30;
})();

// クリーンアップ sweep の実行間隔（ミリ秒）。
// env `ROOM_CLEANUP_INTERVAL_MS` で上書き可能。テストでは短縮するのに使う。
export const ROOM_CLEANUP_INTERVAL_MS = (() => {
  const raw = process.env.ROOM_CLEANUP_INTERVAL_MS;
  if (!raw) return 60 * 60 * 1000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 60 * 60 * 1000;
})();
