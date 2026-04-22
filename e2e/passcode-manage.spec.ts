import { expect, test } from "@playwright/test";
import { createRoomViaApi, deleteRoomViaApi } from "./helpers/api";

test("鍵なしルームの中から『パスコードを設定』すると新しい鍵が表示される", async ({ page, request }) => {
  const { slug } = await createRoomViaApi(request, { name: "E2E 管理-設定" });
  try {
    await page.goto(`/room/${slug}`);
    await page.getByTestId("passcode-button").click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("このルームには現在パスコードが設定されていません")).toBeVisible();

    await page.getByRole("button", { name: "パスコードを設定する" }).click();

    // 設定後は 6 桁表示に切り替わる。
    const code = await page
      .locator('[role="dialog"]')
      .getByText(/^[A-Z0-9]{6}$/)
      .innerText();
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    // 管理用の「再生成」「鍵を外す」ボタンが表示される。
    await expect(page.getByRole("button", { name: "再生成" })).toBeVisible();
    await expect(page.getByRole("button", { name: "鍵を外す" })).toBeVisible();

    await deleteRoomViaApi(request, slug, code);
  } catch (err) {
    await deleteRoomViaApi(request, slug).catch(() => {});
    throw err;
  }
});

test("再生成するとパスコードが変わり、DB にも反映される", async ({ page, request }) => {
  const { slug, passcode } = await createRoomViaApi(request, {
    name: "E2E 管理-再生成",
    withPasscode: true,
  });
  try {
    await page.context().addCookies([
      { name: `xw_passcode_${slug}`, value: passcode!, url: `http://127.0.0.1:3000` },
    ]);
    await page.goto(`/room/${slug}`);
    await page.getByTestId("passcode-button").click();

    await expect(page.locator('[role="dialog"]').getByText(passcode!)).toBeVisible();

    await page.getByRole("button", { name: "再生成" }).click();

    // 古いコードは画面から消え、新しい 6 桁が表示される。
    await expect(page.locator('[role="dialog"]').getByText(passcode!)).toBeHidden();
    const newCode = await page
      .locator('[role="dialog"]')
      .getByText(/^[A-Z0-9]{6}$/)
      .innerText();
    expect(newCode).not.toBe(passcode);

    await deleteRoomViaApi(request, slug, newCode);
  } catch (err) {
    await deleteRoomViaApi(request, slug, passcode).catch(() => {});
    throw err;
  }
});
