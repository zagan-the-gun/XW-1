"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Room, Track } from "@prisma/client";
import { Repeat, Share2, Users, Wifi, WifiOff } from "lucide-react";
import { getSocket } from "@/lib/socket";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { JukeboxPlayer } from "./JukeboxPlayer";
import { QueueList } from "./QueueList";
import { AddTrackForm } from "./AddTrackForm";
import { ParticipantList, type Participant } from "./ParticipantList";

type RoomWithTracks = Room & { tracks: Track[] };

export function RoomClient({ initialRoom }: { initialRoom: RoomWithTracks }) {
  const [room, setRoom] = useState(initialRoom);
  const [tracks, setTracks] = useState<Track[]>(initialRoom.tracks);
  const [currentIndex, setCurrentIndex] = useState(() =>
    initialRoom.tracks.findIndex((t) => t.status === "QUEUED"),
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [connected, setConnected] = useState(false);
  const [userName] = useState(() => {
    if (typeof window === "undefined") return "guest";
    const key = "jukebox:userName";
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const name = `guest-${Math.random().toString(36).slice(2, 6)}`;
    localStorage.setItem(key, name);
    return name;
  });

  const isParty = room.mode === "PARTY";
  const loopPlayback = room.loopPlayback;
  const currentTrack = currentIndex >= 0 ? tracks[currentIndex] : undefined;
  const playerRef = useRef<{ seekTo: (seconds: number) => void } | null>(null);

  // Keep the latest snapshot accessible from callbacks without retriggering effects.
  const latestRef = useRef({ tracks, currentIndex, loopPlayback, isPlaying });
  useEffect(() => {
    latestRef.current = { tracks, currentIndex, loopPlayback, isPlaying };
  }, [tracks, currentIndex, loopPlayback, isPlaying]);

  const refreshTracks = useCallback(async () => {
    const res = await fetch(`/api/rooms/${room.slug}/tracks`);
    if (!res.ok) return;
    const { tracks: t } = (await res.json()) as { tracks: Track[] };
    setTracks(t);
    setCurrentIndex((prev) => {
      const currentId = latestRef.current.tracks[prev]?.id;
      if (currentId) {
        const nextIdx = t.findIndex((x) => x.id === currentId);
        if (nextIdx >= 0) return nextIdx;
      }
      const idx = t.findIndex((x) => x.status === "QUEUED");
      return idx;
    });
  }, [room.slug]);

  useEffect(() => {
    if (!isParty) return;
    const socket = getSocket();

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (socket.connected) setConnected(true);

    socket.emit("join_room", { roomSlug: room.slug, userName });

    const onParticipants = (list: Participant[]) => setParticipants(list);
    const onTrackAdded = () => refreshTracks();
    const onQueueChanged = () => refreshTracks();
    const onPlay = ({ trackId }: { trackId?: string; positionSec?: number }) => {
      if (trackId) {
        const idx = latestRef.current.tracks.findIndex((t) => t.id === trackId);
        if (idx >= 0) setCurrentIndex(idx);
      }
      setIsPlaying(true);
    };
    const onPause = () => setIsPlaying(false);
    const onSkip = () => handleEndedRef.current?.();
    const onSyncState = ({ positionSec }: { trackId?: string; positionSec?: number }) => {
      if (room.playbackMode === "SYNC" && typeof positionSec === "number" && playerRef.current) {
        playerRef.current.seekTo(positionSec);
      }
    };
    const onSettingsChanged = ({ loopPlayback }: { loopPlayback?: boolean }) => {
      if (typeof loopPlayback === "boolean") {
        setRoom((prev) => ({ ...prev, loopPlayback }));
      }
    };

    socket.on("participants", onParticipants);
    socket.on("track_added", onTrackAdded);
    socket.on("queue_changed", onQueueChanged);
    socket.on("play", onPlay);
    socket.on("pause", onPause);
    socket.on("skip", onSkip);
    socket.on("sync_state", onSyncState);
    socket.on("settings_changed", onSettingsChanged);

    return () => {
      socket.emit("leave_room", { roomSlug: room.slug });
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("participants", onParticipants);
      socket.off("track_added", onTrackAdded);
      socket.off("queue_changed", onQueueChanged);
      socket.off("play", onPlay);
      socket.off("pause", onPause);
      socket.off("skip", onSkip);
      socket.off("sync_state", onSyncState);
      socket.off("settings_changed", onSettingsChanged);
    };
  }, [isParty, room.slug, room.playbackMode, userName, refreshTracks]);

  const emit = useCallback(
    (event: string, payload: Record<string, unknown> = {}) => {
      if (!isParty) return;
      getSocket().emit(event, { roomSlug: room.slug, ...payload });
    },
    [isParty, room.slug],
  );

  // Adding a track inserts it right after the current track (and any
  // already-inserted newcomers) when loop mode is on, so it jumps ahead of the
  // rest of the base cycle. The server-side POST handler does the position
  // shifting; we only tell it which track to anchor against.
  const handleAdded = useCallback(
    (track: Track) => {
      setTracks((prev) => {
        // Re-fetch is the safest way to sync positions after an insert, but we
        // optimistically append/insert so the UI doesn't flash empty.
        if (loopPlayback && currentIndex >= 0) {
          // Insert visually after the current "priority run".
          const anchor = prev[currentIndex];
          let insertAt = currentIndex + 1;
          for (let i = currentIndex + 1; i < prev.length; i++) {
            if (prev[i].status === "QUEUED" && prev[i].position > anchor.position) {
              insertAt = i + 1;
            } else {
              break;
            }
          }
          return [...prev.slice(0, insertAt), track, ...prev.slice(insertAt)];
        }
        return [...prev, track];
      });

      setCurrentIndex((prev) => {
        if (prev >= 0) return prev;
        // Empty queue -> start playing the freshly added track.
        return latestRef.current.tracks.findIndex((t) => t.status === "QUEUED") >= 0
          ? latestRef.current.tracks.findIndex((t) => t.status === "QUEUED")
          : 0;
      });

      // Party: broadcast the add, and kick off auto-play when the queue was empty.
      emit("track_added", { trackId: track.id });
      if (latestRef.current.currentIndex < 0) {
        setIsPlaying(true);
        emit("play", { trackId: track.id, positionSec: 0 });
      }

      // Pull the authoritative track list so everyone shares identical positions.
      refreshTracks();
    },
    [loopPlayback, currentIndex, emit, refreshTracks],
  );

  const handleRemove = useCallback(
    async (trackId: string) => {
      const res = await fetch(`/api/rooms/${room.slug}/tracks/${trackId}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      setTracks((prev) => prev.filter((t) => t.id !== trackId));
      emit("queue_changed");
    },
    [room.slug, emit],
  );

  const handleSelect = useCallback(
    (idx: number) => {
      setCurrentIndex(idx);
      setIsPlaying(true);
      emit("play", { trackId: tracks[idx]?.id, positionSec: 0 });
    },
    [tracks, emit],
  );

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      const next = !prev;
      emit(next ? "play" : "pause", { trackId: currentTrack?.id });
      return next;
    });
  }, [emit, currentTrack?.id]);

  // handleEndedRef lets socket listeners call the latest handleEnded without
  // re-subscribing on every render.
  const handleEndedRef = useRef<() => void>(() => {});

  const handleEnded = useCallback(() => {
    const snap = latestRef.current;
    if (snap.currentIndex < 0) return;
    const finishedTrack = snap.tracks[snap.currentIndex];
    if (!finishedTrack) return;

    const updatedTracks = snap.tracks.map((t, i) =>
      i === snap.currentIndex ? { ...t, status: "PLAYED" as const } : t,
    );
    setTracks(updatedTracks);
    fetch(`/api/rooms/${room.slug}/tracks/${finishedTrack.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "PLAYED" }),
    }).catch(() => {});

    const nextIdx = findNextQueued(updatedTracks, snap.currentIndex);
    if (nextIdx >= 0) {
      setCurrentIndex(nextIdx);
      setIsPlaying(true);
      return;
    }

    // No more queued tracks ahead.
    if (snap.loopPlayback) {
      // Cycle end -> reset everyone to QUEUED and restart from the top.
      fetch(`/api/rooms/${room.slug}/tracks/reset`, { method: "POST" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          const reset = data.tracks as Track[];
          setTracks(reset);
          if (reset.length > 0) {
            setCurrentIndex(0);
            setIsPlaying(true);
            emit("play", { trackId: reset[0].id, positionSec: 0 });
          } else {
            setCurrentIndex(-1);
            setIsPlaying(false);
          }
        })
        .catch(() => {});
      return;
    }

    setCurrentIndex(-1);
    setIsPlaying(false);
  }, [room.slug, emit]);

  useEffect(() => {
    handleEndedRef.current = handleEnded;
  }, [handleEnded]);

  const handleSkip = useCallback(() => {
    emit("skip");
    handleEnded();
  }, [emit, handleEnded]);

  const handleToggleLoop = useCallback(async () => {
    const next = !loopPlayback;
    setRoom((prev) => ({ ...prev, loopPlayback: next }));
    emit("settings_changed", { loopPlayback: next });

    try {
      await fetch(`/api/rooms/${room.slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loopPlayback: next }),
      });
    } catch {
      // Revert on failure.
      setRoom((prev) => ({ ...prev, loopPlayback: !next }));
      emit("settings_changed", { loopPlayback: !next });
      return;
    }

    // When turning loop ON while playback is stopped with only PLAYED tracks,
    // restart the cycle immediately so the user gets the expected behavior.
    const snap = latestRef.current;
    if (next && snap.currentIndex < 0 && snap.tracks.length > 0) {
      const res = await fetch(`/api/rooms/${room.slug}/tracks/reset`, {
        method: "POST",
      });
      if (!res.ok) return;
      const { tracks: reset } = (await res.json()) as { tracks: Track[] };
      setTracks(reset);
      if (reset.length > 0) {
        setCurrentIndex(0);
        setIsPlaying(true);
        emit("play", { trackId: reset[0].id, positionSec: 0 });
      }
    }
  }, [loopPlayback, room.slug, emit]);

  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}/room/${room.slug}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: room.name, url });
      } else {
        await navigator.clipboard.writeText(url);
        alert("ルームURLをコピーしました");
      }
    } catch {
      // ignore
    }
  }, [room.slug, room.name]);

  const positionReportRef = useRef(0);
  const handleProgress = useCallback(
    (state: { playedSeconds: number }) => {
      if (room.playbackMode !== "SYNC") return;
      if (!currentTrack) return;
      const now = Date.now();
      if (now - positionReportRef.current < 5000) return;
      positionReportRef.current = now;
      emit("sync_state", { trackId: currentTrack.id, positionSec: state.playedSeconds });
    },
    [room.playbackMode, currentTrack, emit],
  );

  const headerSubtitle = useMemo(
    () =>
      `${room.mode === "PARTY" ? "パーティ" : "ソロ"}モード・${
        room.playbackMode === "SYNC" ? "同期再生" : "ホスト再生"
      }`,
    [room.mode, room.playbackMode],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4 lg:gap-6">
      <div className="space-y-4">
        <Card className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold truncate">{room.name}</h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                {headerSubtitle}・コード <span className="font-mono">{room.slug}</span>
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isParty && (
                <span
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md ${
                    connected ? "bg-green-500/15 text-green-300" : "bg-red-500/15 text-red-300"
                  }`}
                  title={connected ? "接続中" : "未接続"}
                >
                  {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                  {connected ? "接続中" : "再接続中"}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleLoop}
                aria-pressed={loopPlayback}
                title={
                  loopPlayback
                    ? "ループ再生オン（キュー全体をループ）"
                    : "ループ再生オフ（キュー消化で停止）"
                }
                className={loopPlayback ? "!border-primary/70 !text-primary !bg-primary/10" : ""}
              >
                <Repeat className="h-4 w-4" />
                ループ
              </Button>
              <Button variant="outline" size="sm" onClick={handleShare}>
                <Share2 className="h-4 w-4" />
                共有
              </Button>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <JukeboxPlayer
            ref={playerRef}
            track={currentTrack}
            playing={isPlaying}
            onEnded={handleEnded}
            onTogglePlay={handleTogglePlay}
            onSkip={handleSkip}
            onProgress={handleProgress}
            hasNext={findNextQueued(tracks, currentIndex) >= 0 || (loopPlayback && tracks.length > 0)}
          />
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
            曲を追加
          </h2>
          <AddTrackForm
            roomSlug={room.slug}
            insertAfterTrackId={loopPlayback && currentTrack ? currentTrack.id : undefined}
            onAdded={handleAdded}
          />
        </Card>
      </div>

      <aside className="space-y-4">
        {isParty && (
          <Card className="p-4 sm:p-5">
            <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Users className="h-4 w-4" />
              参加者 ({participants.length})
            </h2>
            <ParticipantList participants={participants} me={userName} />
          </Card>
        )}

        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
            キュー ({tracks.length})
          </h2>
          <QueueList
            tracks={tracks}
            currentIndex={currentIndex}
            onSelect={handleSelect}
            onRemove={handleRemove}
          />
        </Card>
      </aside>
    </div>
  );
}

function findNextQueued(tracks: Track[], currentIndex: number) {
  for (let i = currentIndex + 1; i < tracks.length; i++) {
    if (tracks[i].status === "QUEUED" || tracks[i].status === "PLAYING") return i;
  }
  return -1;
}
