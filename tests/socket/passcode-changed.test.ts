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

describe("socket passcode_changed relay", () => {
  it("同じルームの他クライアントに中継され、送信者には返らない", async () => {
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

    const receivedOnB = waitForEvent<{ passcode: string | null }>(b, "passcode_changed");
    const noEchoToA = waitForNoEvent(a, "passcode_changed", 300);

    a.emit("passcode_changed", { roomSlug: "relay-001", passcode: "XYZ987" });

    const payload = await receivedOnB;
    expect(payload.passcode).toBe("XYZ987");
    await noEchoToA;
  });

  it("passcode: null（解除）も同様に中継される", async () => {
    await prisma.room.create({ data: { name: "r", slug: "relay-002", passcode: null } });

    const a = harness.makeClient();
    const b = harness.makeClient();
    await Promise.all([
      new Promise<void>((r) => a.on("connect", r)),
      new Promise<void>((r) => b.on("connect", r)),
    ]);

    a.emit("join_room", { roomSlug: "relay-002", userName: "a" });
    b.emit("join_room", { roomSlug: "relay-002", userName: "b" });
    await waitForEvent(a, "participants");
    await waitForEvent(b, "participants");

    const received = waitForEvent<{ passcode: string | null }>(b, "passcode_changed");
    a.emit("passcode_changed", { roomSlug: "relay-002", passcode: null });

    const payload = await received;
    expect(payload.passcode).toBeNull();
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

    const noReceiveOnB = waitForNoEvent(b, "passcode_changed", 300);
    a.emit("passcode_changed", { roomSlug: "ra-001", passcode: "XYZ987" });
    await noReceiveOnB;
  });
});
