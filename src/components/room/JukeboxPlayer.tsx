"use client";

import dynamic from "next/dynamic";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Pause, Play, SkipForward, Disc3, Volume2, VolumeX } from "lucide-react";
import type { Track } from "@prisma/client";
import { Button } from "@/components/ui/Button";

const ReactPlayer = dynamic(() => import("react-player/lazy"), { ssr: false });

const VOLUME_STORAGE_KEY = "xw1.player.volume";
const MUTED_STORAGE_KEY = "xw1.player.muted";
const DEFAULT_VOLUME = 0.8;

export type JukeboxPlayerHandle = {
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
};

type Props = {
  track?: Track;
  playing: boolean;
  hasNext: boolean;
  // When false this device is "remote control only": no iframe is mounted,
  // no audio plays, but the track title/controls are still shown so the user
  // can add/skip/etc. on behalf of the room.
  listening: boolean;
  onEnded: () => void;
  onTogglePlay: () => void;
  onSkip: () => void;
  onProgress?: (state: { playedSeconds: number }) => void;
};

export const JukeboxPlayer = forwardRef<JukeboxPlayerHandle, Props>(function JukeboxPlayer(
  { track, playing, hasNext, listening, onEnded, onTogglePlay, onSkip, onProgress },
  ref,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null);
  const lastKnownPositionRef = useRef(0);

  useImperativeHandle(ref, () => ({
    seekTo(seconds: number) {
      playerRef.current?.seekTo?.(seconds, "seconds");
    },
    getCurrentTime() {
      const current = playerRef.current?.getCurrentTime?.();
      if (typeof current === "number" && Number.isFinite(current)) return current;
      return lastKnownPositionRef.current;
    },
  }));

  const isNico = track?.platform === "NICONICO";
  // Niconico has no react-player adapter, so we embed it ourselves and let
  // the iframe handle play / pause / volume via its native controls.
  const usesCustomPlayer = isNico;

  // Master volume: persisted in localStorage so it survives track changes and
  // reloads. Niconico is iframe-only (no volume postMessage API), so the
  // slider only affects react-player-based platforms (YouTube / SoundCloud /
  // Vimeo / Wistia) via react-player's `volume` prop.
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    try {
      const storedVolume = window.localStorage.getItem(VOLUME_STORAGE_KEY);
      if (storedVolume !== null) {
        const parsed = Number.parseFloat(storedVolume);
        if (Number.isFinite(parsed)) {
          setVolume(Math.min(1, Math.max(0, parsed)));
        }
      }
      if (window.localStorage.getItem(MUTED_STORAGE_KEY) === "1") {
        setMuted(true);
      }
    } catch {
      // localStorage unavailable (private mode etc.); use defaults.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
    } catch {
      // ignore
    }
  }, [volume]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MUTED_STORAGE_KEY, muted ? "1" : "0");
    } catch {
      // ignore
    }
  }, [muted]);

  const effectiveVolume = muted ? 0 : volume;
  const sliderValue = Math.round(effectiveVolume * 100);

  const handleProgress = (state: { playedSeconds: number }) => {
    lastKnownPositionRef.current = state.playedSeconds;
    onProgress?.(state);
  };

  return (
    <div>
      {listening && (
        <div className="aspect-video w-full bg-black relative">
          {track ? (
            isNico ? (
              <NiconicoPlayer track={track} playing={playing} onEnded={onEnded} />
            ) : (
              <ReactPlayer
                ref={playerRef}
                url={track.url}
                playing={playing}
                controls
                width="100%"
                height="100%"
                volume={effectiveVolume}
                muted={muted}
                onEnded={onEnded}
                onProgress={handleProgress}
                progressInterval={1000}
                config={{
                  youtube: {
                    playerVars: { playsinline: 1 },
                  },
                }}
              />
            )
          ) : (
            <EmptyPlayer />
          )}
        </div>
      )}
      <div className="flex items-center gap-3 p-4 border-t border-border bg-black/30">
        <Button
          size="icon"
          onClick={onTogglePlay}
          disabled={!track || (listening && usesCustomPlayer)}
          aria-label={playing ? "一時停止" : "再生"}
          title={
            listening && usesCustomPlayer
              ? "このプラットフォームはプレイヤー内のコントロールで操作してください"
              : undefined
          }
        >
          {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </Button>
        <Button
          size="icon"
          variant="outline"
          onClick={onSkip}
          disabled={!track || !hasNext}
          aria-label="次の曲へ"
        >
          <SkipForward className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">
            {track?.title ?? "再生する曲がありません"}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {track ? platformLabel(track.platform) : "URLを貼ってキューに追加しましょう"}
          </div>
        </div>
        {listening && (
          <div
            className="flex items-center gap-2 shrink-0"
            title={
              usesCustomPlayer
                ? "このプラットフォームはプレイヤー内の音量で調整してください"
                : undefined
            }
          >
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setMuted((m) => !m)}
              disabled={usesCustomPlayer}
              aria-label={muted ? "ミュート解除" : "ミュート"}
            >
              {muted || volume === 0 ? (
                <VolumeX className="h-5 w-5" />
              ) : (
                <Volume2 className="h-5 w-5" />
              )}
            </Button>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={sliderValue}
              onChange={(e) => {
                const next = Number.parseInt(e.target.value, 10) / 100;
                setVolume(next);
                if (muted && next > 0) setMuted(false);
              }}
              disabled={usesCustomPlayer}
              aria-label="音量"
              className="w-20 sm:w-28 accent-primary disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            />
          </div>
        )}
      </div>
    </div>
  );
});

function EmptyPlayer() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <Disc3 className="h-12 w-12 opacity-40 animate-[spin_8s_linear_infinite]" />
      <p className="text-sm">キューは空っぽです</p>
    </div>
  );
}

function platformLabel(platform: Track["platform"]) {
  switch (platform) {
    case "YOUTUBE":
      return "YouTube";
    case "SOUNDCLOUD":
      return "SoundCloud";
    case "NICONICO":
      return "ニコニコ動画";
    case "VIMEO":
      return "Vimeo";
    case "WISTIA":
      return "Wistia";
    default:
      return platform;
  }
}

// Niconico's embed exposes a postMessage-based JS API when loaded with
// `jsapi=1&playerId=<id>`. We use it to:
//   - detect end-of-playback accurately (fallback: durationSec timer)
//   - issue an explicit play() after loadComplete so we can auto-advance from
//     one niconico track to the next without requiring a manual click.
// Note: jsapi=1 only works from an origin that niconico accepts (i.e. public
// HTTPS, not http://localhost). On localhost this path 403s in the player's
// /play endpoint and surfaces the "プレーヤーを更新…" overlay.
const NICO_PLAYER_ID = "xw1";
const NICO_ORIGIN = "https://embed.nicovideo.jp";

function NiconicoPlayer({
  track,
  playing,
  onEnded,
}: {
  track: Track;
  playing: boolean;
  onEnded: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onEndedRef = useRef(onEnded);
  const endedFiredRef = useRef(false);
  const playingRef = useRef(playing);
  // Ensures we issue at most one play() postMessage per mounted track.
  // Without this we'd fire play on every `playerMetadataChange`, which
  // niconico emits repeatedly during playback, resetting position to 0.
  const playSentRef = useRef(false);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    endedFiredRef.current = false;
    playSentRef.current = false;
  }, [track.id]);

  const fireEnded = () => {
    if (endedFiredRef.current) return;
    endedFiredRef.current = true;
    onEndedRef.current();
  };

  // Duration-based auto-advance as a safety net for cases where the player
  // never sends an "ended" event (muted tab throttling, blocked postMessage,
  // etc.). +3s buffer covers the niconico outro overlay.
  useEffect(() => {
    if (!playing) return;
    if (!track.durationSec) return;
    const ms = (track.durationSec + 3) * 1000;
    const id = window.setTimeout(fireEnded, ms);
    return () => window.clearTimeout(id);
  }, [track.id, track.durationSec, playing]);

  // postMessage bridge: react to player events and issue play/pause commands.
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      if (ev.origin !== NICO_ORIGIN) return;
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const data = ev.data as unknown;
      if (!data || typeof data !== "object") return;
      const d = data as {
        eventName?: string;
        data?: { playerStatus?: number };
      };

      // Observed protocol (empirically verified):
      //   - `loadComplete`            : once, right after the iframe is ready.
      //   - `playerStatusChange`      : status=1 before play, 2 playing,
      //                                 3 paused, 4 ended.
      //   - `statusChange`            : duplicate of playerStatusChange (unused).
      //   - `playerMetadataChange`    : fires repeatedly during playback.
      if (d.eventName === "playerStatusChange") {
        if (d.data?.playerStatus === 4) fireEnded();
      } else if (d.eventName === "ended" || d.eventName === "playerEnd") {
        fireEnded();
      } else if (d.eventName === "loadComplete") {
        if (playingRef.current && !playSentRef.current) {
          playSentRef.current = true;
          iframeRef.current?.contentWindow?.postMessage(
            {
              eventName: "play",
              sourceConnectorType: 1,
              playerId: NICO_PLAYER_ID,
            },
            NICO_ORIGIN,
          );
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const src =
    `https://embed.nicovideo.jp/watch/${encodeURIComponent(track.externalId)}` +
    `?jsapi=1&playerId=${NICO_PLAYER_ID}&autoplay=1`;

  return (
    <iframe
      ref={iframeRef}
      key={track.id}
      src={src}
      className="absolute inset-0 w-full h-full"
      allow="autoplay; encrypted-media; fullscreen"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}

