import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "../helpers/db";
import {
  disconnectAllClients,
  startTestSocketServer,
  waitForEvent,
  waitForNoEvent,
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

describe("socket passcode_changed (server-trusted)", () => {
  it("ペイロードを無視して DB の現値を中継し、送信者には返さない", async () => {
    await prisma.room.create({ data: { name: "r", slug: "relay-001", passcode: null } });

    const a = harness.makeClient();
    const b = harness.makeClient();
    await Promise.all([
      new Promise<void>((r) => a.on("connect", r)),
      new Promise<void>((r) => b.on("connect", r)),
    ]);

    a.emit("join_room", { roomSlug: "relay-001", userName: "a" });
    b.emit("join_room", { roomSlug: "relay-001", userName: "b" });
    await waitForEvent(a, "participants");
    await waitForEvent(b, "participants");

    // PATCH 相当の DB 更新が REST 側で完了している前提のシナリオ。
    await prisma.room.update({ where: { slug: "relay-001" }, data: { passcode: "XYZ987" } });

    const receivedOnB = waitForEvent<{ passcode: string | null }>(b, "passcode_changed");
    const noEchoToA = waitForNoEvent(a, "passcode_changed", 300);

    // 攻撃者を模した「嘘の passcode」を payload で渡しても、サーバは DB の値を返す。
    a.emit("passcode_changed", { roomSlug: "relay-001", passcode: "FAKE12" });

    const payload = await receivedOnB;
    expect(payload.passcode).toBe("XYZ987");
    await noEchoToA;
  });

  it("DB が passcode=null なら null が中継される（解除も DB 経由で同期）", async () => {
    await prisma.room.create({ data: { name: "r", slug: "relay-002", passcode: "ORIG12" } });

    const a = harness.makeClient({ cookie: "xw_passcode_relay-002=ORIG12" });
    const b = harness.makeClient({ cookie: "xw_passcode_relay-002=ORIG12" });
    await Promise.all([
      new Promise<void>((r) => a.on("connect", r)),
      new Promise<void>((r) => b.on("connect", r)),
    ]);

    a.emit("join_room", { roomSlug: "relay-002", userName: "a" });
    b.emit("join_room", { roomSlug: "relay-002", userName: "b" });
    await waitForEvent(a, "participants");
    await waitForEvent(b, "participants");

    await prisma.room.update({ where: { slug: "relay-002" }, data: { passcode: null } });

    const received = waitForEvent<{ passcode: string | null }>(b, "passcode_changed");
    a.emit("passcode_changed", { roomSlug: "relay-002" });

    const payload = await received;
    expect(payload.passcode).toBeNull();
  });

  it("join していないクライアントからの passcode_changed は中継されない", async () => {
    // 攻撃者シナリオ: roomSlug を知っていても、join 済みでなければ broadcast に乗らない。
    await prisma.room.create({ data: { name: "r", slug: "relay-003", passcode: null } });

    const member = harness.makeClient();
    const attacker = harness.makeClient();
    await Promise.all([
      new Promise<void>((r) => member.on("connect", r)),
      new Promise<void>((r) => attacker.on("connect", r)),
    ]);

    member.emit("join_room", { roomSlug: "relay-003", userName: "member" });
    await waitForEvent(member, "participants");

    const noReceive = waitForNoEvent(member, "passcode_changed", 300);
    attacker.emit("passcode_changed", { roomSlug: "relay-003" });
    await noReceive;
  });

  it("別ルームには届かない", async () => {
    await prisma.room.create({ data: { name: "r1", slug: "ra-001", passcode: null } });
    await prisma.room.create({ data: { name: "r2", slug: "rb-001", passcode: null } });

    const a = harness.makeClient();
    const b = harness.makeClient();
    await Promise.all([
      new Promise<void>((r) => a.on("connect", r)),
      new Promise<void>((r) => b.on("connect", r)),
    ]);

    a.emit("join_room", { roomSlug: "ra-001", userName: "a" });
    b.emit("join_room", { roomSlug: "rb-001", userName: "b" });
    await waitForEvent(a, "participants");
    await waitForEvent(b, "participants");

    await prisma.room.update({ where: { slug: "ra-001" }, data: { passcode: "XYZ987" } });

    const noReceiveOnB = waitForNoEvent(b, "passcode_changed", 300);
    a.emit("passcode_changed", { roomSlug: "ra-001" });
    await noReceiveOnB;
  });
});
