import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "../helpers/db";
import {
  disconnectAllClients,
  startTestSocketServer,
  waitForEvent,
  type TestSocketHarness,
} from "../helpers/socket-server";

let harness: TestSocketHarness;

beforeAll(async () => {
  harness = await startTestSocketServer();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await disconnectAllClients(harness);
});

type Participant = { socketId: string; name: string };

describe("socket join_room", () => {
  it("鍵なしルームは Cookie 無しで参加できる", async () => {
    await prisma.room.create({ data: { name: "open", slug: "open-001", passcode: null } });

    const client = harness.makeClient();
    await new Promise<void>((resolve) => client.on("connect", resolve));

    client.emit("join_room", { roomSlug: "open-001", userName: "alice" });
    const participants = await waitForEvent<Participant[]>(client, "participants");
    expect(participants).toHaveLength(1);
    expect(participants[0].name).toBe("alice");
  });

  it("鍵ありルームで Cookie 一致なら参加できる", async () => {
    await prisma.room.create({
      data: { name: "locked", slug: "locked-001", passcode: "A1B2C3" },
    });

    const client = harness.makeClient({ cookie: "xw_passcode_locked-001=A1B2C3" });
    await new Promise<void>((resolve) => client.on("connect", resolve));

    client.emit("join_room", { roomSlug: "locked-001", userName: "alice" });
    const participants = await waitForEvent<Participant[]>(client, "participants");
    expect(participants).toHaveLength(1);
  });

  it("鍵ありルームで Cookie 無しは error イベントで拒否される", async () => {
    await prisma.room.create({
      data: { name: "locked", slug: "locked-002", passcode: "A1B2C3" },
    });

    const client = harness.makeClient();
    await new Promise<void>((resolve) => client.on("connect", resolve));

    client.emit("join_room", { roomSlug: "locked-002", userName: "bob" });
    const err = await waitForEvent<{ message: string }>(client, "error");
    expect(err.message).toBe("Unauthorized");
  });

  it("鍵ありルームで Cookie 不一致も error で拒否される", async () => {
    await prisma.room.create({
      data: { name: "locked", slug: "locked-003", passcode: "A1B2C3" },
    });

    const client = harness.makeClient({ cookie: "xw_passcode_locked-003=WRONG1" });
    await new Promise<void>((resolve) => client.on("connect", resolve));

    client.emit("join_room", { roomSlug: "locked-003", userName: "bob" });
    const err = await waitForEvent<{ message: string }>(client, "error");
    expect(err.message).toBe("Unauthorized");
  });

  it("存在しないルームは error で拒否される", async () => {
    const client = harness.makeClient();
    await new Promise<void>((resolve) => client.on("connect", resolve));

    client.emit("join_room", { roomSlug: "nope", userName: "alice" });
    const err = await waitForEvent<{ message: string }>(client, "error");
    expect(err.message).toBe("Room not found");
  });

  it("join_room で Room.lastOccupiedAt が更新される（空室 TTL リセット）", async () => {
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await prisma.room.create({
      data: { name: "touch-join", slug: "touch-001", lastOccupiedAt: past },
    });

    const client = harness.makeClient();
    await new Promise<void>((resolve) => client.on("connect", resolve));
    client.emit("join_room", { roomSlug: "touch-001", userName: "alice" });
    await waitForEvent(client, "participants");
    // touchRoomOccupancy は await しているが、クライアント側は participants 受信後に
    // 戻ってくるだけなので、DB 反映を少しだけ待つ。
    await new Promise((r) => setTimeout(r, 50));

    const after = await prisma.room.findUnique({ where: { slug: "touch-001" } });
    expect(after!.lastOccupiedAt.getTime()).toBeGreaterThan(past.getTime());
  });

  it("最後の 1 人が leave_room で抜けたときに lastOccupiedAt が更新される", async () => {
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await prisma.room.create({
      data: { name: "touch-leave", slug: "touch-002", lastOccupiedAt: past },
    });

    // 観測役として 2 つめのクライアントを room に残して、抜ける 1 人目 → 0 人の挙動を検証する。
    const observer = harness.makeClient();
    await new Promise<void>((resolve) => observer.on("connect", resolve));
    observer.emit("join_room", { roomSlug: "touch-002", userName: "bob" });
    await waitForEvent(observer, "participants");

    const leaver = harness.makeClient();
    await new Promise<void>((resolve) => leaver.on("connect", resolve));
    leaver.emit("join_room", { roomSlug: "touch-002", userName: "alice" });
    // observer 側で alice 参加の participants を受け取るのを待つ
    await waitForEvent(observer, "participants");

    // observer を先に抜けさせて部屋を leaver 1 人にする
    observer.emit("leave_room", { roomSlug: "touch-002" });
    await waitForEvent(leaver, "participants");

    // ここで DB を過去に戻し、最後の 1 人が抜けたときの touch を確認する
    await prisma.room.update({
      where: { slug: "touch-002" },
      data: { lastOccupiedAt: past },
    });

    leaver.emit("leave_room", { roomSlug: "touch-002" });
    // leaver 自身は leave 後 broadcast を受け取れないので、DB への touch を時間で待つ
    await new Promise((r) => setTimeout(r, 150));

    const after = await prisma.room.findUnique({ where: { slug: "touch-002" } });
    expect(after!.lastOccupiedAt.getTime()).toBeGreaterThan(past.getTime());
  });
});
