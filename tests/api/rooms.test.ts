import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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
});

describe("GET /api/rooms", () => {
  it("各 room に hasPasscode が付き、passcode 自体は露出しない", async () => {
    await prisma.room.create({
      data: { name: "open", slug: "open-1234", passcode: null },
    });
    await prisma.room.create({
      data: { name: "locked", slug: "lock-1234", passcode: "A1B2C3" },
    });

    const res = await GET();
    const data = await readJson<{ rooms: (RoomRes & { passcode?: string })[] }>(res);
    expect(res.status).toBe(200);
    expect(data.rooms).toHaveLength(2);
    for (const r of data.rooms) {
      expect("passcode" in r).toBe(false);
      expect(typeof r.hasPasscode).toBe("boolean");
    }
    const locked = data.rooms.find((r) => r.slug === "lock-1234");
    const open = data.rooms.find((r) => r.slug === "open-1234");
    expect(locked?.hasPasscode).toBe(true);
    expect(open?.hasPasscode).toBe(false);
  });
});
