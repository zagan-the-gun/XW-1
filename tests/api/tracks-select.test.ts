import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/rooms/[slug]/tracks/[trackId]/select/route";
import { prisma } from "@/lib/prisma";
import type { Track, TrackStatus } from "@prisma/client";
import { resetDatabase } from "../helpers/db";
import { jsonRequest, paramsOf, readJson } from "../helpers/requests";

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

async function seedRoomWithTracks(statuses: TrackStatus[]) {
  const room = await prisma.room.create({
    data: { name: "select-test", slug: "sel-001", passcode: null },
  });
  const tracks = await Promise.all(
    statuses.map((status, i) =>
      prisma.track.create({
        data: {
          roomId: room.id,
          url: `https://www.youtube.com/watch?v=track-${i}`,
          platform: "YOUTUBE",
          externalId: `track-${i}`,
          title: `Track ${i}`,
          thumbnail: null,
          durationSec: 60,
          position: i,
          status,
        },
      }),
    ),
  );
  return { room, tracks };
}

describe("POST /api/rooms/[slug]/tracks/[trackId]/select", () => {
  it("クリックした曲より前を PLAYED、その曲含めて以降を QUEUED にリセットする", async () => {
    const { tracks } = await seedRoomWithTracks(["PLAYED", "PLAYED", "QUEUED", "QUEUED", "QUEUED"]);
    const target = tracks[3];

    const res = await POST(
      jsonRequest(`http://localhost/api/rooms/sel-001/tracks/${target.id}/select`, {
        method: "POST",
      }),
      paramsOf({ slug: "sel-001", trackId: target.id }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ tracks: Track[] }>(res);
    expect(data.tracks.map((t) => t.status)).toEqual([
      "PLAYED",
      "PLAYED",
      "PLAYED",
      "QUEUED",
      "QUEUED",
    ]);
  });

  it("先頭の曲を選んだら PLAYED は1つもなく全て QUEUED に戻る", async () => {
    const { tracks } = await seedRoomWithTracks(["PLAYED", "PLAYED", "PLAYED", "QUEUED"]);
    const target = tracks[0];

    const res = await POST(
      jsonRequest(`http://localhost/api/rooms/sel-001/tracks/${target.id}/select`, {
        method: "POST",
      }),
      paramsOf({ slug: "sel-001", trackId: target.id }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ tracks: Track[] }>(res);
    expect(data.tracks.every((t) => t.status === "QUEUED")).toBe(true);
  });

  it("末尾の曲を選んだら以前は全て PLAYED に揃う", async () => {
    const { tracks } = await seedRoomWithTracks(["QUEUED", "QUEUED", "QUEUED", "QUEUED"]);
    const target = tracks[3];

    const res = await POST(
      jsonRequest(`http://localhost/api/rooms/sel-001/tracks/${target.id}/select`, {
        method: "POST",
      }),
      paramsOf({ slug: "sel-001", trackId: target.id }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ tracks: Track[] }>(res);
    expect(data.tracks.map((t) => t.status)).toEqual([
      "PLAYED",
      "PLAYED",
      "PLAYED",
      "QUEUED",
    ]);
  });

  it("SKIPPED な曲も対象になる（前なら PLAYED に塗り替え、後なら QUEUED に戻る）", async () => {
    const { tracks } = await seedRoomWithTracks([
      "PLAYED",
      "SKIPPED",
      "QUEUED",
      "SKIPPED",
      "QUEUED",
    ]);
    const target = tracks[2];

    const res = await POST(
      jsonRequest(`http://localhost/api/rooms/sel-001/tracks/${target.id}/select`, {
        method: "POST",
      }),
      paramsOf({ slug: "sel-001", trackId: target.id }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ tracks: Track[] }>(res);
    expect(data.tracks.map((t) => t.status)).toEqual([
      "PLAYED",
      "PLAYED",
      "QUEUED",
      "QUEUED",
      "QUEUED",
    ]);
  });

  it("存在しないルームは 404", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/rooms/nope/tracks/x/select", { method: "POST" }),
      paramsOf({ slug: "nope", trackId: "x" }),
    );
    expect(res.status).toBe(404);
  });

  it("ルームに属さない trackId は 404", async () => {
    await seedRoomWithTracks(["QUEUED"]);
    const res = await POST(
      jsonRequest("http://localhost/api/rooms/sel-001/tracks/not-found/select", {
        method: "POST",
      }),
      paramsOf({ slug: "sel-001", trackId: "not-found" }),
    );
    expect(res.status).toBe(404);
  });
});
