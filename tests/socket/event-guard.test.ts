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

// 「鍵付きルームに join していない第三者が roomSlug だけ知って emit すると配送される」
// という前回レビューの脆弱性を塞いだ確認テスト。
describe("socket event guard (sender must be joined)", () => {
  async function setupMemberAndAttacker(slug: string) {
    await prisma.room.create({ data: { name: "guard", slug, passcode: null } });
    const member = harness.makeClient();
    const attacker = harness.makeClient();
    await Promise.all([
      new Promise<void>((r) => member.on("connect", r)),
      new Promise<void>((r) => attacker.on("connect", r)),
    ]);
    member.emit("join_room", { roomSlug: slug, userName: "m" });
    await waitForEvent(member, "participants");
    return { member, attacker };
  }

  it("join していないクライアントの play は他人に届かず、エラーが本人に返る", async () => {
    const slug = "guard-001";
    const { member, attacker } = await setupMemberAndAttacker(slug);

    const noReceive = waitForNoEvent(member, "play", 300);
    const errOnAttacker = waitForEvent<{ message: string }>(attacker, "error");
    attacker.emit("play", { roomSlug: slug, trackId: "fake", positionSec: 0 });

    await noReceive;
    expect((await errOnAttacker).message).toBe("Not joined");
  });

  it("pause / skip / track_added / queue_changed / settings_changed / state_query も同様", async () => {
    const slug = "guard-002";
    const { member, attacker } = await setupMemberAndAttacker(slug);

    const events = [
      ["pause", {}],
      ["skip", {}],
      ["track_added", { trackId: "x" }],
      ["queue_changed", {}],
      ["settings_changed", { loopPlayback: true }],
      ["state_query", {}],
    ] as const;

    for (const [event, extra] of events) {
      const noReceive = waitForNoEvent(member, event, 200);
      attacker.emit(event, { roomSlug: slug, ...extra });
      await noReceive;
    }
  });

  it("自分が join しているルームと違う slug への emit も配送されない", async () => {
    await prisma.room.create({ data: { name: "a", slug: "guard-A", passcode: null } });
    await prisma.room.create({ data: { name: "b", slug: "guard-B", passcode: null } });

    const inA = harness.makeClient();
    const inB = harness.makeClient();
    await Promise.all([
      new Promise<void>((r) => inA.on("connect", r)),
      new Promise<void>((r) => inB.on("connect", r)),
    ]);
    inA.emit("join_room", { roomSlug: "guard-A", userName: "a" });
    inB.emit("join_room", { roomSlug: "guard-B", userName: "b" });
    await waitForEvent(inA, "participants");
    await waitForEvent(inB, "participants");

    // inA が guard-B に対して play を emit しても、guard-B 側 (inB) には届かない。
    const noReceive = waitForNoEvent(inB, "play", 300);
    inA.emit("play", { roomSlug: "guard-B", trackId: "x", positionSec: 0 });
    await noReceive;
  });
});
