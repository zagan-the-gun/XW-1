import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE, POST } from "@/app/api/rooms/[slug]/auth/route";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "../helpers/db";
import { findSetCookie, jsonRequest, paramsOf } from "../helpers/requests";

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

async function createLockedRoom(passcode = "A1B2C3") {
  return prisma.room.create({
    data: { name: "locked", slug: "locked-001", passcode },
  });
}

describe("POST /api/rooms/[slug]/auth", () => {
  it("正しいパスコードを渡すと Set-Cookie を返す", async () => {
    await createLockedRoom("A1B2C3");
    const res = await POST(
      jsonRequest("http://localhost/api/rooms/locked-001/auth", {
        method: "POST",
        body: { passcode: "A1B2C3" },
      }),
      paramsOf({ slug: "locked-001" }),
    );
    expect(res.status).toBe(200);
    const setCookie = findSetCookie(res, "xw_passcode_locked-001");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("xw_passcode_locked-001=A1B2C3");
    expect(setCookie).toContain("HttpOnly");
  });

  it("不正なパスコードは 401 で Set-Cookie を返さない", async () => {
    await createLockedRoom("A1B2C3");
    const res = await POST(
      jsonRequest("http://localhost/api/rooms/locked-001/auth", {
        method: "POST",
        body: { passcode: "X9Y8Z7" },
      }),
      paramsOf({ slug: "locked-001" }),
    );
    expect(res.status).toBe(401);
    expect(findSetCookie(res, "xw_passcode_locked-001")).toBeUndefined();
  });

  it("フォーマット違反は 400", async () => {
    await createLockedRoom("A1B2C3");
    const res = await POST(
      jsonRequest("http://localhost/api/rooms/locked-001/auth", {
        method: "POST",
        body: { passcode: "abc" },
      }),
      paramsOf({ slug: "locked-001" }),
    );
    expect(res.status).toBe(400);
  });

  it("鍵なしルームへの auth は 400", async () => {
    await prisma.room.create({
      data: { name: "open", slug: "open-001", passcode: null },
    });
    const res = await POST(
      jsonRequest("http://localhost/api/rooms/open-001/auth", {
        method: "POST",
        body: { passcode: "A1B2C3" },
      }),
      paramsOf({ slug: "open-001" }),
    );
    expect(res.status).toBe(400);
  });

  it("存在しないルームは 404", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/rooms/nope/auth", {
        method: "POST",
        body: { passcode: "A1B2C3" },
      }),
      paramsOf({ slug: "nope" }),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/rooms/[slug]/auth", () => {
  it("Max-Age=0 の Set-Cookie を返す", async () => {
    const res = await DELETE(
      jsonRequest("http://localhost/api/rooms/locked-001/auth", { method: "DELETE" }),
      paramsOf({ slug: "locked-001" }),
    );
    expect(res.status).toBe(200);
    const setCookie = findSetCookie(res, "xw_passcode_locked-001");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("Max-Age=0");
  });
});
