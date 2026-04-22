import { expect, test } from "@playwright/test";
import { createRoomViaApi, deleteRoomViaApi } from "./helpers/api";

test("再生成しても既存メンバーは自動追従し、外部は新パスコードを要求される", async ({
  browser,
  request,
}) => {
  const { slug, passcode } = await createRoomViaApi(request, {
    name: "E2E 自動追従",
    withPasscode: true,
  });
  if (!passcode) throw new Error("passcode was not generated");

  const baseURL = "http://127.0.0.1:3000";
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  let currentCode = passcode;

  try {
    await ctxA.addCookies([{ name: `xw_passcode_${slug}`, value: passcode, url: baseURL }]);
    await ctxB.addCookies([{ name: `xw_passcode_${slug}`, value: passcode, url: baseURL }]);

    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await Promise.all([pageA.goto(`/room/${slug}`), pageB.goto(`/room/${slug}`)]);

    // 両タブでルーム画面（passcode ボタンが見える）に入れている。
    await expect(pageA.getByTestId("passcode-button")).toBeVisible();
    await expect(pageB.getByTestId("passcode-button")).toBeVisible();

    // A が再生成。
    await pageA.getByTestId("passcode-button").click();
    await pageA.getByRole("button", { name: "再生成" }).click();

    const newCodeEl = pageA.locator('[role="dialog"]').getByText(/^[A-Z0-9]{6}$/);
    await expect(newCodeEl).toBeVisible();
    const newCode = await newCodeEl.innerText();
    expect(newCode).not.toBe(passcode);
    currentCode = newCode;

    // B 側にトーストが出る（自動追従）。
    await expect(pageB.getByText(/パスコードが [A-Z0-9]{6} に変更されました/)).toBeVisible();

    // B はリロードしても Gate に落ちない（Cookie が更新されている）。
    await pageB.reload();
    await expect(pageB.getByTestId("passcode-button")).toBeVisible();

    // 全く新規のコンテキストは Gate に遭遇し、古いコードでは弾かれる。
    const ctxC = await browser.newContext();
    try {
      const pageC = await ctxC.newPage();
      await pageC.goto(`/room/${slug}`);
      await expect(pageC.getByText("このルームはパスコードが必要です")).toBeVisible();

      await pageC.getByLabel("パスコード").fill(passcode);
      await pageC.getByRole("button", { name: "入室" }).click();
      await expect(pageC.getByText("パスコードが違います")).toBeVisible();

      await pageC.getByLabel("パスコード").fill(newCode);
      await pageC.getByRole("button", { name: "入室" }).click();
      await expect(pageC.getByTestId("passcode-button")).toBeVisible();
    } finally {
      await ctxC.close();
    }
  } finally {
    await ctxA.close();
    await ctxB.close();
    await deleteRoomViaApi(request, slug, currentCode).catch(() => {});
  }
});
