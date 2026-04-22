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
});
