import { expect, test } from "@playwright/test";
import { deleteRoomViaApi } from "./helpers/api";

test("トグルをONにすると横にパスコードが表示され、作成と同時にルームへ遷移する", async ({
  browser,
  page,
  request,
}) => {
  await page.goto("/");

  await page.getByLabel("ルーム名").fill("E2E 鍵付きルーム");

  // トグルをONにした瞬間に 6 桁パスコードが表示される。
  await page.getByTestId("with-passcode-switch").click();
  const preview = page.getByTestId("passcode-preview");
  await expect(preview).toBeVisible();
  const code = await preview.locator("span").first().innerText();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  // 「ルームを作成」で即ルームへ遷移する（モーダルを挟まない）。
  await page.getByRole("button", { name: "ルームを作成" }).click();
  await expect(page.getByTestId("passcode-button")).toBeVisible();

  const slug = page.url().split("/room/").pop()!;

  // ルーム内のパスコード管理ダイアログに、フォームで表示した値と同じパスコードが保存されている。
  await page.getByTestId("passcode-button").click();
  await expect(page.locator('[role="dialog"]').getByText(code)).toBeVisible();

  // 別コンテキストから同じ URL を開くと Gate に弾かれ、正解パスコードで入れる。
  const guestCtx = await browser.newContext();
  try {
    const guest = await guestCtx.newPage();
    await guest.goto(`/room/${slug}`);
    await expect(guest.getByText("このルームはパスコードが必要です")).toBeVisible();

    await guest.getByLabel("パスコード").fill("WRONG1");
    await guest.getByRole("button", { name: "入室" }).click();
    await expect(guest.getByText("パスコードが違います")).toBeVisible();

    await guest.getByLabel("パスコード").fill(code);
    await guest.getByRole("button", { name: "入室" }).click();
    await expect(guest.getByTestId("passcode-button")).toBeVisible();
  } finally {
    await guestCtx.close();
  }

  await deleteRoomViaApi(request, slug, code);
});

test("再生成ボタンでパスコードが別の値に変わる", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("with-passcode-switch").click();
  const preview = page.getByTestId("passcode-preview");
  const before = await preview.locator("span").first().innerText();

  await page.getByRole("button", { name: "パスコードを再生成" }).click();
  const after = await preview.locator("span").first().innerText();

  expect(after).toMatch(/^[A-Z0-9]{6}$/);
  expect(after).not.toBe(before);
});

test("鍵なしで作成すればパスコードモーダルを挟まずに遷移する", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("ルーム名").fill("E2E 鍵なしルーム");
  await page.getByRole("button", { name: "ルームを作成" }).click();

  await expect(page.getByTestId("passcode-button")).toBeVisible();
  const slug = page.url().split("/room/").pop()!;
  await deleteRoomViaApi(request, slug);
});
