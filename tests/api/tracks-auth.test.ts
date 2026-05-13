import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearMockCookies, setMockCookies } from "../helpers/next-cookies-mock";

vi.mock("@/lib/metadata", () => ({
  fetchMetadata: vi.fn(async (url: string) => ({
    platform: "YOUTUBE",
    externalId: "vid-" + url.slice(-3),
    url,
    title: "mock-title",
    thumbnail: null,
    durationSec: 60,
  })),
}));

import { GET as listTracks, POST as addTrack } from "@/app/api/rooms/[slug]/tracks/route";
import { DELETE as deleteTrack, PATCH as patchTrack } from "@/app/api/rooms/[slug]/tracks/[trackId]/route";
import { POST as selectTrack } from "@/app/api/rooms/[slug]/tracks/[trackId]/select/route";
import { POST as resetTracks } from "@/app/api/rooms/[slug]/tracks/reset/route";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "../helpers/db";
import { jsonRequest, paramsOf } from "../helpers/requests";

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

async function seedLocked(passcode = "A1B2C3") {
  const room = await prisma.room.create({
    data: { name: "locked", slug: "lock-001", passcode },
  });
  const track = await prisma.track.create({
    data: {
      roomId: room.id,
      url: "https://www.youtube.com/watch?v=existing",
      platform: "YOUTUBE",
      externalId: "existing",
      title: "Existing",
      thumbnail: null,
      durationSec: 60,
      position: 0,
    },
  });
  return { room, track };
}

describe("鍵付きルームの REST /tracks 系は Cookie 認可必須", () => {
  it("GET /tracks: Cookie なしは 401（一覧も透けさせない）", async () => {
    await seedLocked();
    const res = await listTracks(
      jsonRequest("http://localhost/api/rooms/lock-001/tracks"),
      paramsOf({ slug: "lock-001" }),
    );
    expect(res.status).toBe(401);
  });

  it("POST /tracks: Cookie なしは 401（曲追加できない）", async () => {
    await seedLocked();
    const res = await addTrack(
      jsonRequest("http://localhost/api/rooms/lock-001/tracks", {
        method: "POST",
        body: { url: "https://www.youtube.com/watch?v=ABC" },
      }),
      paramsOf({ slug: "lock-001" }),
    );
    expect(res.status).toBe(401);
  });

  it("PATCH /tracks/[id]: Cookie なしは 401", async () => {
    const { track } = await seedLocked();
    const res = await patchTrack(
      jsonRequest(`http://localhost/api/rooms/lock-001/tracks/${track.id}`, {
        method: "PATCH",
        body: { status: "PLAYED" },
      }),
      paramsOf({ slug: "lock-001", trackId: track.id }),
    );
    expect(res.status).toBe(401);
  });

  it("DELETE /tracks/[id]: Cookie なしは 401", async () => {
    const { track } = await seedLocked();
    const res = await deleteTrack(
      jsonRequest(`http://localhost/api/rooms/lock-001/tracks/${track.id}`, { method: "DELETE" }),
      paramsOf({ slug: "lock-001", trackId: track.id }),
    );
    expect(res.status).toBe(401);
  });

  it("POST /tracks/[id]/select: Cookie なしは 401", async () => {
    const { track } = await seedLocked();
    const res = await selectTrack(
      jsonRequest(`http://localhost/api/rooms/lock-001/tracks/${track.id}/select`, {
        method: "POST",
      }),
      paramsOf({ slug: "lock-001", trackId: track.id }),
    );
    expect(res.status).toBe(401);
  });

  it("POST /tracks/reset: Cookie なしは 401", async () => {
    await seedLocked();
    const res = await resetTracks(
      jsonRequest("http://localhost/api/rooms/lock-001/tracks/reset", { method: "POST" }),
      paramsOf({ slug: "lock-001" }),
    );
    expect(res.status).toBe(401);
  });

  it("Cookie が一致していれば一連の操作が通る（GET / POST / PATCH / DELETE / select / reset）", async () => {
    const { track } = await seedLocked();
    setMockCookies({ "xw_passcode_lock-001": "A1B2C3" });

    expect(
      (
        await listTracks(
          jsonRequest("http://localhost/api/rooms/lock-001/tracks"),
          paramsOf({ slug: "lock-001" }),
        )
      ).status,
    ).toBe(200);

    expect(
      (
        await addTrack(
          jsonRequest("http://localhost/api/rooms/lock-001/tracks", {
            method: "POST",
            body: { url: "https://www.youtube.com/watch?v=NEW" },
          }),
          paramsOf({ slug: "lock-001" }),
        )
      ).status,
    ).toBe(201);

    expect(
      (
        await patchTrack(
          jsonRequest(`http://localhost/api/rooms/lock-001/tracks/${track.id}`, {
            method: "PATCH",
            body: { status: "PLAYED" },
          }),
          paramsOf({ slug: "lock-001", trackId: track.id }),
        )
      ).status,
    ).toBe(200);

    expect(
      (
        await selectTrack(
          jsonRequest(`http://localhost/api/rooms/lock-001/tracks/${track.id}/select`, {
            method: "POST",
          }),
          paramsOf({ slug: "lock-001", trackId: track.id }),
        )
      ).status,
    ).toBe(200);

    expect(
      (
        await resetTracks(
          jsonRequest("http://localhost/api/rooms/lock-001/tracks/reset", { method: "POST" }),
          paramsOf({ slug: "lock-001" }),
        )
      ).status,
    ).toBe(200);

    expect(
      (
        await deleteTrack(
          jsonRequest(`http://localhost/api/rooms/lock-001/tracks/${track.id}`, {
            method: "DELETE",
          }),
          paramsOf({ slug: "lock-001", trackId: track.id }),
        )
      ).status,
    ).toBe(200);
  });
});

describe("鍵なしルームの REST /tracks 系は Cookie 不要", () => {
  it("GET / POST / PATCH / DELETE / select / reset 全部 Cookie なしで通る", async () => {
    const room = await prisma.room.create({
      data: { name: "open", slug: "open-001", passcode: null },
    });
    const track = await prisma.track.create({
      data: {
        roomId: room.id,
        url: "https://www.youtube.com/watch?v=existing",
        platform: "YOUTUBE",
        externalId: "existing",
        title: "Existing",
        thumbnail: null,
        durationSec: 60,
        position: 0,
      },
    });

    expect(
      (
        await listTracks(
          jsonRequest("http://localhost/api/rooms/open-001/tracks"),
          paramsOf({ slug: "open-001" }),
        )
      ).status,
    ).toBe(200);

    expect(
      (
        await addTrack(
          jsonRequest("http://localhost/api/rooms/open-001/tracks", {
            method: "POST",
            body: { url: "https://www.youtube.com/watch?v=NEW" },
          }),
          paramsOf({ slug: "open-001" }),
        )
      ).status,
    ).toBe(201);

    expect(
      (
        await patchTrack(
          jsonRequest(`http://localhost/api/rooms/open-001/tracks/${track.id}`, {
            method: "PATCH",
            body: { status: "PLAYED" },
          }),
          paramsOf({ slug: "open-001", trackId: track.id }),
        )
      ).status,
    ).toBe(200);
  });
});
