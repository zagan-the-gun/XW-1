import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// next/headers の cookies() を差し替え。これは import 前に走らせる必要があるので先頭に置く。
import { clearMockCookies, setMockCookies } from "../helpers/next-cookies-mock";

import { DELETE, GET, PATCH } from "@/app/api/rooms/[slug]/route";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "../helpers/db";
import { findSetCookie, jsonRequest, paramsOf, readJson } from "../helpers/requests";

type RoomRes = {
  slug: string;
  name: string;
  hasPasscode: boolean;
  passcode: string | null;
  loopPlayback: boolean;
};

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  clearMockCookies();
});

afterEach(() => {
  clearMockCookies();
});

async function seedOpen() {
  return prisma.room.create({
    data: { name: "open", slug: "open-001", passcode: null },
  });
}

async function seedLocked(passcode = "A1B2C3") {
  return prisma.room.create({
    data: { name: "locked", slug: "locked-001", passcode },
  });
}

describe("GET /api/rooms/[slug]", () => {
  it("鍵なしルームは Cookie 不要で 200", async () => {
    await seedOpen();
    const res = await GET(
      jsonRequest("http://localhost/api/rooms/open-001"),
      paramsOf({ slug: "open-001" }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ room: RoomRes }>(res);
    expect(data.room.hasPasscode).toBe(false);
    expect(data.room.passcode).toBeNull();
  });

  it("鍵ありルームで Cookie 一致なら 200 + passcode を露出", async () => {
    await seedLocked("A1B2C3");
    setMockCookies({ "xw_passcode_locked-001": "A1B2C3" });
    const res = await GET(
      jsonRequest("http://localhost/api/rooms/locked-001"),
      paramsOf({ slug: "locked-001" }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ room: RoomRes }>(res);
    expect(data.room.hasPasscode).toBe(true);
    expect(data.room.passcode).toBe("A1B2C3");
  });

  it("鍵ありルームで Cookie 無しは 401", async () => {
    await seedLocked("A1B2C3");
    const res = await GET(
      jsonRequest("http://localhost/api/rooms/locked-001"),
      paramsOf({ slug: "locked-001" }),
    );
    expect(res.status).toBe(401);
  });

  it("鍵ありルームで Cookie 不一致は 401", async () => {
    await seedLocked("A1B2C3");
    setMockCookies({ "xw_passcode_locked-001": "WRONG0" });
    const res = await GET(
      jsonRequest("http://localhost/api/rooms/locked-001"),
      paramsOf({ slug: "locked-001" }),
    );
    expect(res.status).toBe(401);
  });

  it("存在しないルームは 404", async () => {
    const res = await GET(
      jsonRequest("http://localhost/api/rooms/nope"),
      paramsOf({ slug: "nope" }),
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/rooms/[slug]", () => {
  it("鍵なしルームの loopPlayback は誰でも更新できる", async () => {
    await seedOpen();
    const res = await PATCH(
      jsonRequest("http://localhost/api/rooms/open-001", {
        method: "PATCH",
        body: { loopPlayback: true },
      }),
      paramsOf({ slug: "open-001" }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ room: RoomRes }>(res);
    expect(data.room.loopPlayback).toBe(true);
  });

  it("鍵ありルームの loopPlayback 更新は Cookie 必須", async () => {
    await seedLocked("A1B2C3");
    const res = await PATCH(
      jsonRequest("http://localhost/api/rooms/locked-001", {
        method: "PATCH",
        body: { loopPlayback: true },
      }),
      paramsOf({ slug: "locked-001" }),
    );
    expect(res.status).toBe(401);
  });

  it("鍵ありルームで Cookie 一致なら loopPlayback 更新できる", async () => {
    await seedLocked("A1B2C3");
    setMockCookies({ "xw_passcode_locked-001": "A1B2C3" });
    const res = await PATCH(
      jsonRequest("http://localhost/api/rooms/locked-001", {
        method: "PATCH",
        body: { loopPlayback: true },
      }),
      paramsOf({ slug: "locked-001" }),
    );
    expect(res.status).toBe(200);
  });

  it("鍵なしルームに passcode:regenerate は誰でも実行でき新パスコードと Set-Cookie が返る", async () => {
    await seedOpen();
    const res = await PATCH(
      jsonRequest("http://localhost/api/rooms/open-001", {
        method: "PATCH",
        body: { passcode: "regenerate" },
      }),
      paramsOf({ slug: "open-001" }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ room: RoomRes }>(res);
    expect(data.room.passcode).toMatch(/^[A-Z0-9]{6}$/);
    const setCookie = findSetCookie(res, "xw_passcode_open-001");
    expect(setCookie).toContain(`xw_passcode_open-001=${data.room.passcode}`);
  });

  it("鍵ありルームの passcode:regenerate は Cookie 必須", async () => {
    await seedLocked("A1B2C3");
    const res = await PATCH(
      jsonRequest("http://localhost/api/rooms/locked-001", {
        method: "PATCH",
        body: { passcode: "regenerate" },
      }),
      paramsOf({ slug: "locked-001" }),
    );
    expect(res.status).toBe(401);
  });

  it("鍵ありルームで Cookie 一致なら再生成でき、新値が保存・返却される", async () => {
    await seedLocked("A1B2C3");
    setMockCookies({ "xw_passcode_locked-001": "A1B2C3" });
    const res = await PATCH(
      jsonRequest("http://localhost/api/rooms/locked-001", {
        method: "PATCH",
        body: { passcode: "regenerate" },
      }),
      paramsOf({ slug: "locked-001" }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ room: RoomRes }>(res);
    expect(data.room.passcode).toMatch(/^[A-Z0-9]{6}$/);
    expect(data.room.passcode).not.toBe("A1B2C3");
    const persisted = await prisma.room.findUnique({ where: { slug: "locked-001" } });
    expect(persisted?.passcode).toBe(data.room.passcode);
  });

  it("passcode:null は鍵を外し Set-Cookie は Max-Age=0", async () => {
    await seedLocked("A1B2C3");
    setMockCookies({ "xw_passcode_locked-001": "A1B2C3" });
    const res = await PATCH(
      jsonRequest("http://localhost/api/rooms/locked-001", {
        method: "PATCH",
        body: { passcode: null },
      }),
      paramsOf({ slug: "locked-001" }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ room: RoomRes }>(res);
    expect(data.room.passcode).toBeNull();
    expect(data.room.hasPasscode).toBe(false);
    const setCookie = findSetCookie(res, "xw_passcode_locked-001");
    expect(setCookie).toContain("Max-Age=0");
  });
});

describe("DELETE /api/rooms/[slug]", () => {
  it("鍵なしルームは Cookie 不要で削除できる", async () => {
    await seedOpen();
    const res = await DELETE(
      jsonRequest("http://localhost/api/rooms/open-001", { method: "DELETE" }),
      paramsOf({ slug: "open-001" }),
    );
    expect(res.status).toBe(200);
    const persisted = await prisma.room.findUnique({ where: { slug: "open-001" } });
    expect(persisted).toBeNull();
  });

  it("鍵ありルームは Cookie 一致時のみ削除できる", async () => {
    await seedLocked("A1B2C3");

    const bad = await DELETE(
      jsonRequest("http://localhost/api/rooms/locked-001", { method: "DELETE" }),
      paramsOf({ slug: "locked-001" }),
    );
    expect(bad.status).toBe(401);
    expect(await prisma.room.findUnique({ where: { slug: "locked-001" } })).not.toBeNull();

    setMockCookies({ "xw_passcode_locked-001": "A1B2C3" });
    const good = await DELETE(
      jsonRequest("http://localhost/api/rooms/locked-001", { method: "DELETE" }),
      paramsOf({ slug: "locked-001" }),
    );
    expect(good.status).toBe(200);
    expect(await prisma.room.findUnique({ where: { slug: "locked-001" } })).toBeNull();
  });
});
