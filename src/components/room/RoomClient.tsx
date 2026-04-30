"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Room, Track } from "@prisma/client";
import {
  Headphones,
  HeadphoneOff,
  KeyRound,
  Lock,
  Repeat,
  Share2,
  Unlock,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { getSocket } from "@/lib/socket";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Toaster, useToaster } from "@/components/ui/Toast";
import { JukeboxPlayer, type JukeboxPlayerHandle } from "./JukeboxPlayer";
import { QueueList } from "./QueueList";
import { AddTrackForm } from "./AddTrackForm";
import { ParticipantList, type Participant } from "./ParticipantList";
import { ShareDialog } from "./ShareDialog";
import { PasscodeDialog } from "./PasscodeDialog";

type RoomWithTracks = Room & { tracks: Track[] };

const LISTENING_KEY = (slug: string) => `jukebox:listening:${slug}`;

export function RoomClient({ initialRoom }: { initialRoom: RoomWithTracks }) {
  const [room, setRoom] = useState(initialRoom);
  const [tracks, setTracks] = useState<Track[]>(initialRoom.tracks);
  const [currentIndex, setCurrentIndex] = useState(() =>
    initialRoom.tracks.findIndex((t) => t.status === "QUEUED"),
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [connected, setConnected] = useState(false);
  // Per-user / per-device listening toggle. ON = this browser mounts the
  // iframe and actually plays audio. OFF = remote-control only (no audio,
  // no video, but the user can still see the queue and press play/skip/etc.
  // to drive what the other listeners hear).
  const [listening, setListening] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [passcodeOpen, setPasscodeOpen] = useState(false);
  const [passcode, setPasscode] = useState<string | null>(initialRoom.passcode);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToaster();
  const [userName] = useState(() => {
    if (typeof window === "undefined") return "guest";
    const key = "jukebox:userName";
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const name = `guest-${Math.random().toString(36).slice(2, 6)}`;
    localStorage.setItem(key, name);
    return name;
  });

  // Load the listening preference on mount (client-only).
  useEffect(() => {
    try {
      setListening(window.localStorage.getItem(LISTENING_KEY(room.slug)) === "1");
    } catch {
      // localStorage unavailable; fall back to OFF (default).
    }
  }, [room.slug]);

  const loopPlayback = room.loopPlayback;
  const currentTrack = currentIndex >= 0 ? tracks[currentIndex] : undefined;
  const playerRef = useRef<JukeboxPlayerHandle | null>(null);

  // Keep the latest snapshot accessible from callbacks without retriggering effects.
  const latestRef = useRef({ tracks, currentIndex, loopPlayback, isPlaying, listening });
  useEffect(() => {
    latestRef.current = { tracks, currentIndex, loopPlayback, isPlaying, listening };
  }, [tracks, currentIndex, loopPlayback, isPlaying, listening]);

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

  // Pending state-query flag: set when we OFF->ON toggle and emit state_query,
  // cleared on first reply or on the 1s fallback timeout.
  const pendingStateQueryRef = useRef(false);

  // handleEndedRef lets socket listeners call the latest handleEnded without
  // re-subscribing on every render.
  const handleEndedRef = useRef<() => void>(() => {});

  useEffect(() => {
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
    const onSettingsChanged = ({ loopPlayback }: { loopPlayback?: boolean }) => {
      if (typeof loopPlayback === "boolean") {
        setRoom((prev) => ({ ...prev, loopPlayback }));
      }
    };

    // 他の参加者がパスコードを追加/再生成/削除した。自分の Cookie を自動で
    // 張り替えて「鍵が変わって締め出される」体験を避ける（案A の自動追従）。
    const onPasscodeChanged = async ({ passcode: next }: { passcode: string | null }) => {
      try {
        if (next) {
          await fetch(`/api/rooms/${room.slug}/auth`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ passcode: next }),
          });
        } else {
          await fetch(`/api/rooms/${room.slug}/auth`, { method: "DELETE" });
        }
      } catch {
        // Cookie 更新失敗時は次回リロードで Gate に落ちる。今は継続を優先。
      }
      setPasscode(next);
      pushToast(
        next
          ? { message: `パスコードが ${next} に変更されました`, tone: "info", icon: <Lock className="h-4 w-4" /> }
          : { message: "パスコードが解除されました", tone: "info", icon: <Unlock className="h-4 w-4" /> },
      );
    };

    // Another peer just flipped their listening toggle ON and wants to know
    // what's playing. Only respond if we're actively listening with a track
    // so the requester gets a real, current position.
    const onStateQuery = ({ requesterSocketId }: { requesterSocketId: string }) => {
      const snap = latestRef.current;
      if (!snap.listening || !snap.isPlaying || snap.currentIndex < 0) return;
      const track = snap.tracks[snap.currentIndex];
      if (!track) return;
      const positionSec = playerRef.current?.getCurrentTime?.() ?? 0;
      socket.emit("state_reply", { requesterSocketId, trackId: track.id, positionSec });
    };

    // Race-based: the first reply wins and is used to seek. All subsequent
    // replies are dropped because pendingStateQueryRef has been cleared.
    const onStateReply = ({ trackId, positionSec }: { trackId: string; positionSec: number }) => {
      if (!pendingStateQueryRef.current) return;
      pendingStateQueryRef.current = false;
      const snap = latestRef.current;
      const idx = snap.tracks.findIndex((t) => t.id === trackId);
      if (idx < 0) return;
      setCurrentIndex(idx);
      setIsPlaying(true);
      // Player iframe may still be mounting; delay the seek so it takes effect.
      setTimeout(() => {
        playerRef.current?.seekTo(positionSec);
      }, 500);
    };

    socket.on("participants", onParticipants);
    socket.on("track_added", onTrackAdded);
    socket.on("queue_changed", onQueueChanged);
    socket.on("play", onPlay);
    socket.on("pause", onPause);
    socket.on("skip", onSkip);
    socket.on("settings_changed", onSettingsChanged);
    socket.on("passcode_changed", onPasscodeChanged);
    socket.on("state_query", onStateQuery);
    socket.on("state_reply", onStateReply);

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
      socket.off("settings_changed", onSettingsChanged);
      socket.off("passcode_changed", onPasscodeChanged);
      socket.off("state_query", onStateQuery);
      socket.off("state_reply", onStateReply);
    };
  }, [room.slug, userName, refreshTracks, pushToast]);

  const emit = useCallback(
    (event: string, payload: Record<string, unknown> = {}) => {
      getSocket().emit(event, { roomSlug: room.slug, ...payload });
    },
    [room.slug],
  );

  // Tracks always append to the end of the queue. Auto-start playback only
  // when the room is currently idle (no current track).
  const handleAdded = useCallback(
    (track: Track) => {
      setTracks((prev) => [...prev, track]);

      setCurrentIndex((prev) => {
        if (prev >= 0) return prev;
        const idx = latestRef.current.tracks.findIndex((t) => t.status === "QUEUED");
        return idx >= 0 ? idx : 0;
      });

      emit("track_added", { trackId: track.id });
      if (latestRef.current.currentIndex < 0) {
        setIsPlaying(true);
        emit("play", { trackId: track.id, positionSec: 0 });
      }

      refreshTracks();
    },
    [emit, refreshTracks],
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
      const nextTrack = updatedTracks[nextIdx];
      setCurrentIndex(nextIdx);
      setIsPlaying(true);
      // Broadcast the natural advance so every peer (including non-listening
      // remote controllers) jumps to this track's head. Lag peers lose the
      // final seconds of the finished track — deliberate trade-off per spec.
      emit("play", { trackId: nextTrack.id, positionSec: 0 });
      return;
    }

    // No more queued tracks ahead.
    if (snap.loopPlayback) {
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
      setRoom((prev) => ({ ...prev, loopPlayback: !next }));
      emit("settings_changed", { loopPlayback: !next });
      return;
    }

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

  const handleToggleListening = useCallback(() => {
    setListening((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(LISTENING_KEY(room.slug), next ? "1" : "0");
      } catch {
        // ignore (private mode etc.)
      }

      if (next) {
        // OFF -> ON: ask peers where the playback is. The first reply wins.
        // If no peer answers within 1s, fall back to "start the first QUEUED
        // track from 0" so a solo user isn't stuck.
        pendingStateQueryRef.current = true;
        getSocket().emit("state_query", { roomSlug: room.slug });
        setTimeout(() => {
          if (!pendingStateQueryRef.current) return;
          pendingStateQueryRef.current = false;
          const snap = latestRef.current;
          if (snap.currentIndex < 0) {
            const firstQueued = snap.tracks.findIndex((t) => t.status === "QUEUED");
            if (firstQueued >= 0) {
              setCurrentIndex(firstQueued);
              setIsPlaying(true);
            }
          } else if (!snap.isPlaying) {
            setIsPlaying(true);
          }
        }, 1000);
      } else {
        // ON -> OFF: stop local audio without affecting other listeners.
        // The iframe will unmount via the `listening` prop, so we only need
        // to flip isPlaying locally (without broadcasting pause).
        setIsPlaying(false);
      }
      return next;
    });
  }, [room.slug]);

  const handleShare = useCallback(() => {
    setShareUrl(`${window.location.origin}/room/${room.slug}`);
    setShareOpen(true);
  }, [room.slug]);

  // 自分がダイアログから PATCH を叩いて passcode を変更した後のコールバック。
  // サーバ側で DB は更新済み。自分の Cookie も PATCH のレスポンスで張り替わっている。
  // 残作業は state 更新と、他の参加者への Socket 通知、自分向けトースト表示。
  const handlePasscodeLocalChange = useCallback(
    (next: string | null) => {
      setPasscode(next);
      getSocket().emit("passcode_changed", { roomSlug: room.slug, passcode: next });
      pushToast(
        next
          ? {
              message: `パスコードを ${next} に設定しました`,
              tone: "success",
              icon: <Lock className="h-4 w-4" />,
            }
          : {
              message: "パスコードを解除しました",
              tone: "success",
              icon: <Unlock className="h-4 w-4" />,
            },
      );
    },
    [room.slug, pushToast],
  );

  const headerSubtitle = useMemo(
    () => (listening ? "この端末で再生中" : "リモコンモード（音は鳴りません）"),
    [listening],
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
              <span
                className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md ${
                  connected ? "bg-green-500/15 text-green-300" : "bg-red-500/15 text-red-300"
                }`}
                title={connected ? "接続中" : "未接続"}
              >
                {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {connected ? "接続中" : "再接続中"}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleListening}
                aria-pressed={listening}
                title={
                  listening
                    ? "同期オン（この端末でも曲を流す）"
                    : "同期オフ（他の参加者の端末でのみ再生）"
                }
                className={listening ? "!border-primary/70 !text-primary !bg-primary/10" : ""}
              >
                {listening ? (
                  <Headphones className="h-4 w-4" />
                ) : (
                  <HeadphoneOff className="h-4 w-4" />
                )}
                同期
              </Button>
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPasscodeOpen(true)}
                aria-pressed={Boolean(passcode)}
                title={passcode ? "パスコードを管理（鍵あり）" : "パスコードを管理（鍵なし）"}
                className={passcode ? "!border-primary/70 !text-primary !bg-primary/10" : ""}
                data-testid="passcode-button"
              >
                {passcode ? <Lock className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                鍵
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
            listening={listening}
            onEnded={handleEnded}
            onTogglePlay={handleTogglePlay}
            onSkip={handleSkip}
            hasNext={findNextQueued(tracks, currentIndex) >= 0 || (loopPlayback && tracks.length > 0)}
          />
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
            曲を追加
          </h2>
          <AddTrackForm roomSlug={room.slug} onAdded={handleAdded} />
        </Card>
      </div>

      <aside className="space-y-4">
        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Users className="h-4 w-4" />
            参加者 ({participants.length})
          </h2>
          <ParticipantList participants={participants} me={userName} />
        </Card>

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

      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title={room.name}
        url={shareUrl}
      />

      <PasscodeDialog
        open={passcodeOpen}
        onClose={() => setPasscodeOpen(false)}
        slug={room.slug}
        passcode={passcode}
        onChanged={handlePasscodeLocalChange}
      />

      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function findNextQueued(tracks: Track[], currentIndex: number) {
  for (let i = currentIndex + 1; i < tracks.length; i++) {
    if (tracks[i].status === "QUEUED" || tracks[i].status === "PLAYING") return i;
  }
  return -1;
}
