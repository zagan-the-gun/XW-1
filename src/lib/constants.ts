// 1 ルームあたりのトラック上限。
// env `MAX_TRACKS_PER_ROOM` で上書き可能（運用中に再デプロイなしで調整するため）。
export const MAX_TRACKS_PER_ROOM = (() => {
  const raw = process.env.MAX_TRACKS_PER_ROOM;
  if (!raw) return 1000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1000;
})();

// アプリ全体で同時に存在できるルーム数の上限。
// 外部公開時に「無限ルーム作成 → DB 飽和」を防ぐためのソフトリミット。
// env `MAX_ROOMS_TOTAL` で上書き可能（運用中に再デプロイなしで調整するため）。
export const MAX_ROOMS_TOTAL = (() => {
  const raw = process.env.MAX_ROOMS_TOTAL;
  if (!raw) return 100;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 100;
})();

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
