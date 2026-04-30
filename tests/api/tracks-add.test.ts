import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// fetchMetadata は外部 oEmbed API を叩くのでテストでは固定値に差し替える。
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

import { POST } from "@/app/api/rooms/[slug]/tracks/route";
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

async function seedRoom() {
  return prisma.room.create({
    data: { name: "add-test", slug: "add-001", passcode: null },
  });
}

async function seedTracks(roomId: string, statuses: TrackStatus[]) {
  return Promise.all(
    statuses.map((status, i) =>
      prisma.track.create({
        data: {
          roomId,
          url: `https://www.youtube.com/watch?v=existing-${i}`,
          platform: "YOUTUBE",
          externalId: `existing-${i}`,
          title: `Existing ${i}`,
          thumbnail: null,
          durationSec: 60,
          position: i,
          status,
        },
      }),
    ),
  );
}

describe("POST /api/rooms/[slug]/tracks", () => {
  it("空のキューに追加すると position=0 で末尾に作られる", async () => {
    await seedRoom();
    const res = await POST(
      jsonRequest("http://localhost/api/rooms/add-001/tracks", {
        method: "POST",
        body: { url: "https://www.youtube.com/watch?v=AAA" },
      }),
      paramsOf({ slug: "add-001" }),
    );
    expect(res.status).toBe(201);
    const data = await readJson<{ track: Track }>(res);
    expect(data.track.position).toBe(0);
  });

  it("再生中（PLAYING）と未再生（QUEUED）が混在する状態でも常に末尾へ追加される", async () => {
    const room = await seedRoom();
    await seedTracks(room.id, ["PLAYED", "PLAYING", "QUEUED", "QUEUED"]);

    const res = await POST(
      jsonRequest("http://localhost/api/rooms/add-001/tracks", {
        method: "POST",
        body: { url: "https://www.youtube.com/watch?v=NEW" },
      }),
      paramsOf({ slug: "add-001" }),
    );
    expect(res.status).toBe(201);
    const data = await readJson<{ track: Track }>(res);
    expect(data.track.position).toBe(4);
    expect(data.track.status).toBe("QUEUED");

    const all = await prisma.track.findMany({
      where: { roomId: room.id },
      orderBy: { position: "asc" },
    });
    expect(all.map((t) => t.position)).toEqual([0, 1, 2, 3, 4]);
    expect(all[4].externalId).toBe("vid-NEW");
  });

  it("insertAfterTrackId は受け取っても無視される（schema で剥がされる）", async () => {
    const room = await seedRoom();
    const seeded = await seedTracks(room.id, ["PLAYING", "QUEUED", "QUEUED"]);
    const anchor = seeded[0];

    const res = await POST(
      jsonRequest("http://localhost/api/rooms/add-001/tracks", {
        method: "POST",
        body: {
          url: "https://www.youtube.com/watch?v=IGN",
          insertAfterTrackId: anchor.id,
        },
      }),
      paramsOf({ slug: "add-001" }),
    );
    expect(res.status).toBe(201);
    const data = await readJson<{ track: Track }>(res);
    expect(data.track.position).toBe(3);
  });

  it("URL が不正なら 400", async () => {
    await seedRoom();
    const res = await POST(
      jsonRequest("http://localhost/api/rooms/add-001/tracks", {
        method: "POST",
        body: { url: "not-a-url" },
      }),
      paramsOf({ slug: "add-001" }),
    );
    expect(res.status).toBe(400);
  });

  it("存在しないルームは 404", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/rooms/nope/tracks", {
        method: "POST",
        body: { url: "https://www.youtube.com/watch?v=AAA" },
      }),
      paramsOf({ slug: "nope" }),
    );
    expect(res.status).toBe(404);
  });
});
