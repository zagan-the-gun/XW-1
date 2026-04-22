import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    // 本番 DB を誤爆しないための起動時ガード。詳細は tests/helpers/guard.ts 参照。
    setupFiles: ["./tests/helpers/guard.ts"],
    // API / Socket テストは実 DB を共有するため、ファイル並列もテスト並列も禁止する。
    // これで TRUNCATE と CREATE が競合しない。
    fileParallelism: false,
    pool: "forks",
    sequence: { concurrent: false },
  },
});
