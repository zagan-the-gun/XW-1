import { defineConfig, devices } from "@playwright/test";

// ホスト側から Docker 内の dev サーバを叩く想定。E2E 実行前に docker compose up が必要。
// 既存の dev DB を使うため、テストは自分で createRoom して自己完結的に完結させる。
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

