import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "../helpers/db";
import { runRoomCleanup } from "@/server/room-cleanup";
import { ROOM_INACTIVITY_TTL_DAYS } from "@/lib/constants";
import {
  disconnectAllClients,
  startTestSocketServer,
  waitForEvent,
  type TestSocketHarness,
} from "../helpers/socket-server";
import { __resetParticipantsForTest } from "@/server/socket-handler";

let harness: TestSocketHarness;

beforeAll(async () => {
  harness = await startTestSocketServer();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetDatabase();
  __resetParticipantsForTest();
});

afterEach(async () => {
  await disconnectAllClients(harness);
  __resetParticipantsForTest();
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe("runRoomCleanup", () => {
  it(`lastOccupiedAt が ${ROOM_INACTIVITY_TTL_DAYS} 日より古いルームは削除される`, async () => {
    const tooOld = new Date(Date.now() - (ROOM_INACTIVITY_TTL_DAYS + 1) * MS_PER_DAY);
    const fresh = new Date();

    await prisma.room.create({
      data: { name: "stale", slug: "stale-001", lastOccupiedAt: tooOld },
    });
    await prisma.room.create({
      data: { name: "alive", slug: "alive-001", lastOccupiedAt: fresh },
    });

    const res = await runRoomCleanup();
    expect(res.deletedRooms).toBe(1);

    expect(await prisma.room.findUnique({ where: { slug: "stale-001" } })).toBeNull();
    expect(await prisma.room.findUnique({ where: { slug: "alive-001" } })).not.toBeNull();
  });

  it("TTL 境界（ちょうど TTL 日前）のルームは削除されない", async () => {
    // lt 比較なので「TTL 日ちょうど前」は削除対象外。
    const onTheLine = new Date(Date.now() - ROOM_INACTIVITY_TTL_DAYS * MS_PER_DAY + 1000);
    await prisma.room.create({
      data: { name: "edge", slug: "edge-001", lastOccupiedAt: onTheLine },
    });

    const res = await runRoomCleanup();
    expect(res.deletedRooms).toBe(0);
    expect(await prisma.room.findUnique({ where: { slug: "edge-001" } })).not.toBeNull();
  });

  it("Track は onDelete: Cascade で連鎖削除される", async () => {
    const tooOld = new Date(Date.now() - (ROOM_INACTIVITY_TTL_DAYS + 1) * MS_PER_DAY);
    const room = await prisma.room.create({
      data: { name: "with-tracks", slug: "track-001", lastOccupiedAt: tooOld },
    });
    await prisma.track.create({
      data: {
        roomId: room.id,
        url: "https://example.com/1",
        platform: "YOUTUBE",
        externalId: "abc",
        title: "t",
        position: 0,
      },
    });

    await runRoomCleanup();

    expect(await prisma.room.findUnique({ where: { slug: "track-001" } })).toBeNull();
    expect(await prisma.track.count({ where: { roomId: room.id } })).toBe(0);
  });

  it("socket で参加中のルームは sweep 時に lastOccupiedAt が更新され、TTL 到達を防ぐ", async () => {
    // ほぼ TTL 切れ手前の状態でスタート → join_room → sweep で touched に入って延命される
    const almostExpired = new Date(Date.now() - (ROOM_INACTIVITY_TTL_DAYS - 0.01) * MS_PER_DAY);
    await prisma.room.create({
      data: { name: "occupied", slug: "occ-001", lastOccupiedAt: almostExpired },
    });

    const client = harness.makeClient();
    await new Promise<void>((resolve) => client.on("connect", resolve));
    client.emit("join_room", { roomSlug: "occ-001", userName: "alice" });
    await waitForEvent(client, "participants");

    const res = await runRoomCleanup();
    expect(res.touchedOccupiedRooms).toBe(1);
    expect(res.deletedRooms).toBe(0);

    const after = await prisma.room.findUnique({ where: { slug: "occ-001" } });
    expect(after).not.toBeNull();
    // touch されたので lastOccupiedAt は almostExpired より新しくなっているはず
    expect(after!.lastOccupiedAt.getTime()).toBeGreaterThan(almostExpired.getTime());
  });

  it("lastOccupiedAt が将来時刻でもエラーにならず削除対象にもならない（安全側の挙動）", async () => {
    const future = new Date(Date.now() + 10 * MS_PER_DAY);
    await prisma.room.create({
      data: { name: "future", slug: "future-001", lastOccupiedAt: future },
    });

    const res = await runRoomCleanup();
    expect(res.deletedRooms).toBe(0);
    expect(await prisma.room.findUnique({ where: { slug: "future-001" } })).not.toBeNull();
  });
});
