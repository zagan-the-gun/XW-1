// テストが本番 DB (`jukebox`) を誤って叩かないようにする最終ガード。
// Vitest の setupFiles から読み込まれ、起動直後に 1 回走る。
//
// ここで落とすのは以下のケース:
//   - `npm test` 経由でなく `npx vitest` を直接呼ばれた
//   - `.env.test` の読み込みに失敗した
//   - CI 環境で DATABASE_URL を本番や dev に向けてしまった
//
// これにより truncate が本番データを消してしまう事故を防ぐ。

const url = process.env.DATABASE_URL ?? "";

// "jukebox_test" を含むこと、少なくとも "jukebox" 単体で終わらないことを要求する。
if (!url || !/\bjukebox_test\b/.test(url)) {
  throw new Error(
    [
      "Vitest refused to start: DATABASE_URL does not point to the test database (jukebox_test).",
      "",
      `  Current DATABASE_URL: ${url || "(unset)"}`,
      "",
      "If you intended to run tests, use `npm test` / `npm run test:watch` (which load .env.test).",
      "Never run `npx vitest` directly against the dev DB; this fixture truncates tables.",
    ].join("\n"),
  );
}
