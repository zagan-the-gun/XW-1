import { expect, test } from "@playwright/test";
import { createRoomViaApi, deleteRoomViaApi } from "./helpers/api";

test("鍵を外すと既存メンバーに通知が出て、以降は Gate 無しで入室できる", async ({
  browser,
  request,
}) => {
  const { slug, passcode } = await createRoomViaApi(request, {
    name: "E2E 鍵解除",
    withPasscode: true,
  });
  if (!passcode) throw new Error("passcode was not generated");

  const baseURL = "http://127.0.0.1:3000";
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  try {
    await ctxA.addCookies([{ name: `xw_passcode_${slug}`, value: passcode, url: baseURL }]);
    await ctxB.addCookies([{ name: `xw_passcode_${slug}`, value: passcode, url: baseURL }]);

    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await Promise.all([pageA.goto(`/room/${slug}`), pageB.goto(`/room/${slug}`)]);
    await expect(pageA.getByTestId("passcode-button")).toBeVisible();
    await expect(pageB.getByTestId("passcode-button")).toBeVisible();

    // A が鍵を外す。
    await pageA.getByTestId("passcode-button").click();
    await pageA.getByRole("button", { name: "鍵を外す" }).click();

    // ダイアログが「鍵なし」状態に切り替わる。
    await expect(
      pageA.getByText("このルームには現在パスコードが設定されていません"),
    ).toBeVisible();

    // B にトーストが表示される。
    await expect(pageB.getByText("パスコードが解除されました")).toBeVisible();

    // 全く新規のコンテキストは Gate なしで入れる。
    const ctxC = await browser.newContext();
    try {
      const pageC = await ctxC.newPage();
      await pageC.goto(`/room/${slug}`);
      await expect(pageC.getByTestId("passcode-button")).toBeVisible();
      await expect(pageC.getByText("このルームはパスコードが必要です")).toBeHidden();
    } finally {
      await ctxC.close();
    }
  } finally {
    await ctxA.close();
    await ctxB.close();
    await deleteRoomViaApi(request, slug).catch(() => {});
  }
});
