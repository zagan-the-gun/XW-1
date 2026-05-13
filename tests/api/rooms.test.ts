import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// テスト内で「上限到達」を再現したいので constants を小さい値に差し替える。
// このファイル内に閉じたモックなので他テストファイルには影響しない。
vi.mock("@/lib/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/constants")>();
  return { ...actual, MAX_ROOMS_TOTAL: 2 };
});

import { GET, POST } from "@/app/api/rooms/route";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "../helpers/db";
import { findSetCookie, jsonRequest, readJson } from "../helpers/requests";

type RoomRes = {
  slug: string;
  name: string;
  hasPasscode: boolean;
};

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("POST /api/rooms", () => {
  it("鍵なしルームを作成しパスコード関連のフィールドを返さない", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/rooms", {
        method: "POST",
        body: { name: "テストルーム" },
      }),
    );
    expect(res.status).toBe(201);
    const data = await readJson<{ room: RoomRes; passcode: string | null }>(res);
    expect(data.room.name).toBe("テストルーム");
    expect(data.room.hasPasscode).toBe(false);
    expect(data.passcode).toBeNull();
    expect(findSetCookie(res, `xw_passcode_${data.room.slug}`)).toBeUndefined();
  });

  it("withPasscode=true で作成するとパスコードと Set-Cookie が返る", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/rooms", {
        method: "POST",
        body: { name: "鍵付きルーム", withPasscode: true },
      }),
    );
    expect(res.status).toBe(201);
    const data = await readJson<{ room: RoomRes; passcode: string | null }>(res);
    expect(data.room.hasPasscode).toBe(true);
    expect(data.passcode).toMatch(/^[A-Z0-9]{6}$/);

    const setCookie = findSetCookie(res, `xw_passcode_${data.room.slug}`);
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain(`xw_passcode_${data.room.slug}=${data.passcode}`);
    expect(setCookie).toContain("HttpOnly");

    const saved = await prisma.room.findUnique({ where: { slug: data.room.slug } });
    expect(saved?.passcode).toBe(data.passcode);
  });

  it("passcode を明示指定すると、その値でそのまま作成される（クライアント事前生成に対応）", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/rooms", {
        method: "POST",
        body: { name: "事前生成ルーム", passcode: "XYZ987" },
      }),
    );
    expect(res.status).toBe(201);
    const data = await readJson<{ room: RoomRes; passcode: string | null }>(res);
    expect(data.passcode).toBe("XYZ987");
    expect(data.room.hasPasscode).toBe(true);

    const setCookie = findSetCookie(res, `xw_passcode_${data.room.slug}`);
    expect(setCookie).toContain(`xw_passcode_${data.room.slug}=XYZ987`);

    const saved = await prisma.room.findUnique({ where: { slug: data.room.slug } });
    expect(saved?.passcode).toBe("XYZ987");
  });

  it("不正なフォーマットの passcode 明示指定は 400 で拒否する", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/rooms", {
        method: "POST",
        body: { name: "駄目なパスコード", passcode: "abc" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("name が空だと 400 を返す", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/rooms", {
        method: "POST",
        body: { name: "" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("ルーム数が MAX_ROOMS_TOTAL 未満なら作成できる", async () => {
    // mock により上限は 2。1 件作成済み → 2 件目は通る。
    await prisma.room.create({ data: { name: "first", slug: "limit-001" } });
    const res = await POST(
      jsonRequest("http://localhost/api/rooms", {
        method: "POST",
        body: { name: "second" },
      }),
    );
    expect(res.status).toBe(201);
  });

  it("ルーム数が MAX_ROOMS_TOTAL に達していると 409 で拒否する", async () => {
    await prisma.room.create({ data: { name: "first", slug: "limit-101" } });
    await prisma.room.create({ data: { name: "second", slug: "limit-102" } });
    const res = await POST(
      jsonRequest("http://localhost/api/rooms", {
        method: "POST",
        body: { name: "third" },
      }),
    );
    expect(res.status).toBe(409);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toContain("2");
    expect(await prisma.room.count()).toBe(2);
  });
});

describe("GET /api/rooms", () => {
  it("鍵なしルームのみ返り、鍵付きルームは一覧に含まれない", async () => {
    await prisma.room.create({
      data: { name: "open", slug: "open-1234", passcode: null },
    });
    await prisma.room.create({
      data: { name: "locked", slug: "lock-1234", passcode: "A1B2C3" },
    });

    const res = await GET();
    const data = await readJson<{ rooms: (RoomRes & { passcode?: string })[] }>(res);
    expect(res.status).toBe(200);
    expect(data.rooms).toHaveLength(1);
    expect(data.rooms[0].slug).toBe("open-1234");
    expect(data.rooms[0].hasPasscode).toBe(false);
    expect("passcode" in data.rooms[0]).toBe(false);
  });

  it("ルームが 0 件でも空配列を返す", async () => {
    const res = await GET();
    const data = await readJson<{ rooms: unknown[] }>(res);
    expect(res.status).toBe(200);
    expect(data.rooms).toEqual([]);
  });
});
