import { afterEach, describe, expect, it, vi } from "vitest";
import type { Track, TrackStatus } from "@prisma/client";
import { findNextQueued, pickIndexAfterAdd, pickRandomQueued } from "@/lib/queue";

function makeTrack(i: number, status: TrackStatus): Track {
  return {
    id: `t-${i}`,
    roomId: "room-1",
    addedById: null,
    url: `https://example.com/${i}`,
    platform: "YOUTUBE",
    externalId: `ext-${i}`,
    title: `Track ${i}`,
    thumbnail: null,
    durationSec: 60,
    position: i,
    status,
    addedAt: new Date("2025-01-01T00:00:00Z"),
  };
}

function makeTracks(statuses: TrackStatus[]): Track[] {
  return statuses.map((s, i) => makeTrack(i, s));
}

describe("pickIndexAfterAdd", () => {
  it("再生中 (prevIndex >= 0) のときは index を維持する", () => {
    const tracks = makeTracks(["PLAYING", "QUEUED"]);
    expect(pickIndexAfterAdd(0, tracks)).toBe(0);
    expect(pickIndexAfterAdd(1, tracks)).toBe(1);
  });

  it("アイドル状態でキューに QUEUED が残っていればその index を返す", () => {
    const tracks = makeTracks(["PLAYED", "QUEUED", "QUEUED"]);
    expect(pickIndexAfterAdd(-1, tracks)).toBe(1);
  });

  it("ループOFF + 全曲消化後 (全て PLAYED) に追加すると、新曲の末尾 index を返す", () => {
    // これが今回のリグレッションテスト。`0` を返すと先頭の PLAYED 曲が
    // 巻き戻し再生されるバグになる。
    const tracks = makeTracks(["PLAYED", "PLAYED", "PLAYED"]);
    expect(pickIndexAfterAdd(-1, tracks)).toBe(3);
  });

  it("PLAYED と SKIPPED が混在していても末尾 index を返す", () => {
    const tracks = makeTracks(["PLAYED", "SKIPPED", "PLAYED", "SKIPPED"]);
    expect(pickIndexAfterAdd(-1, tracks)).toBe(4);
  });

  it("初期キューが空のときは 0 を返す（= 追加直後の先頭）", () => {
    expect(pickIndexAfterAdd(-1, [])).toBe(0);
  });

  it("キューに QUEUED が残っていれば末尾追加よりそちらを優先する", () => {
    // currentIndex = -1 でもキュー後半に QUEUED があるレアケース。
    // 既存の QUEUED を優先して順番通りに消化する。
    const tracks = makeTracks(["PLAYED", "PLAYED", "QUEUED"]);
    expect(pickIndexAfterAdd(-1, tracks)).toBe(2);
  });
});

describe("findNextQueued", () => {
  it("currentIndex の次にある QUEUED を返す", () => {
    const tracks = makeTracks(["PLAYING", "QUEUED", "QUEUED"]);
    expect(findNextQueued(tracks, 0)).toBe(1);
  });

  it("PLAYING も次トラック候補として扱う", () => {
    const tracks = makeTracks(["PLAYED", "PLAYING", "QUEUED"]);
    expect(findNextQueued(tracks, 0)).toBe(1);
  });

  it("PLAYED / SKIPPED はスキップして次の QUEUED を探す", () => {
    const tracks = makeTracks(["PLAYING", "PLAYED", "SKIPPED", "QUEUED"]);
    expect(findNextQueued(tracks, 0)).toBe(3);
  });

  it("末尾まで到達したら -1", () => {
    const tracks = makeTracks(["PLAYING", "PLAYED", "PLAYED"]);
    expect(findNextQueued(tracks, 0)).toBe(-1);
  });

  it("currentIndex = -1 のときは先頭から探す", () => {
    const tracks = makeTracks(["QUEUED", "QUEUED"]);
    expect(findNextQueued(tracks, -1)).toBe(0);
  });

  it("空配列なら -1", () => {
    expect(findNextQueued([], -1)).toBe(-1);
  });
});

describe("pickRandomQueued", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("候補が無ければ -1", () => {
    expect(pickRandomQueued([])).toBe(-1);
    expect(pickRandomQueued(makeTracks(["PLAYED", "SKIPPED"]))).toBe(-1);
  });

  it("QUEUED が 1 つだけならその index を返す", () => {
    const tracks = makeTracks(["PLAYED", "QUEUED", "PLAYED"]);
    expect(pickRandomQueued(tracks)).toBe(1);
  });

  it("PLAYING も候補に含める", () => {
    const tracks = makeTracks(["PLAYED", "PLAYING", "PLAYED"]);
    expect(pickRandomQueued(tracks)).toBe(1);
  });

  it("複数候補から Math.random に従って index を返す（先頭側）", () => {
    const tracks = makeTracks(["QUEUED", "PLAYED", "QUEUED", "QUEUED"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(pickRandomQueued(tracks)).toBe(0);
  });

  it("複数候補から Math.random に従って index を返す（末尾側）", () => {
    const tracks = makeTracks(["QUEUED", "PLAYED", "QUEUED", "QUEUED"]);
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    expect(pickRandomQueued(tracks)).toBe(3);
  });

  it("excludeId で指定された曲は候補から外れる", () => {
    const tracks = makeTracks(["QUEUED", "QUEUED", "QUEUED"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    // t-0 を excludeId にすると候補は [t-1, t-2]、その先頭 t-1 (index 1) が選ばれる。
    expect(pickRandomQueued(tracks, { excludeId: "t-0" })).toBe(1);
  });

  it("excludeId で候補が 0 件になるなら exclude を無視してフォールバック（曲が 1 つしかない時の救済）", () => {
    const tracks = makeTracks(["QUEUED"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(pickRandomQueued(tracks, { excludeId: "t-0" })).toBe(0);
  });

  it("excludeId 該当曲だけを除外し、他の status (PLAYED/SKIPPED) は元から候補外", () => {
    const tracks = makeTracks(["PLAYED", "QUEUED", "QUEUED", "SKIPPED"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    // 候補は t-1, t-2。excludeId=t-1 で t-2 だけ残り index 2。
    expect(pickRandomQueued(tracks, { excludeId: "t-1" })).toBe(2);
  });
});
