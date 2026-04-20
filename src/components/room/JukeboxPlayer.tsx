"use client";

import dynamic from "next/dynamic";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Pause, Play, SkipForward, Disc3 } from "lucide-react";
import type { Track } from "@prisma/client";
import { Button } from "@/components/ui/Button";

const ReactPlayer = dynamic(() => import("react-player/lazy"), { ssr: false });

export type JukeboxPlayerHandle = {
  seekTo: (seconds: number) => void;
};

type Props = {
  track?: Track;
  playing: boolean;
  hasNext: boolean;
  onEnded: () => void;
  onTogglePlay: () => void;
  onSkip: () => void;
  onProgress?: (state: { playedSeconds: number }) => void;
};

export const JukeboxPlayer = forwardRef<JukeboxPlayerHandle, Props>(function JukeboxPlayer(
  { track, playing, hasNext, onEnded, onTogglePlay, onSkip, onProgress },
  ref,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null);

  useImperativeHandle(ref, () => ({
    seekTo(seconds: number) {
      playerRef.current?.seekTo?.(seconds, "seconds");
    },
  }));

  const isNico = track?.platform === "NICONICO";

  return (
    <div>
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
              onEnded={onEnded}
              onProgress={onProgress}
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
      <div className="flex items-center gap-3 p-4 border-t border-border bg-black/30">
        <Button
          size="icon"
          onClick={onTogglePlay}
          disabled={!track || isNico}
          aria-label={playing ? "一時停止" : "再生"}
          title={isNico ? "ニコニコ動画はプレイヤー内のコントロールで操作してください" : undefined}
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
    default:
      return platform;
  }
}

// Niconico's embed player does not expose a stable public JS API from
// third-party origins (jsapi=1 triggers an "update player" overlay on
// non-whitelisted hosts), so we render the bare official iframe and rely on
// `durationSec` (fetched via getthumbinfo at track add time) to auto-advance.
// Users still control playback via the niconico controls inside the iframe.
function NiconicoPlayer({
  track,
  playing,
  onEnded,
}: {
  track: Track;
  playing: boolean;
  onEnded: () => void;
}) {
  const onEndedRef = useRef(onEnded);
  const endedFiredRef = useRef(false);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    endedFiredRef.current = false;
  }, [track.id]);

  // Duration-based auto-advance. +3s buffer covers the overlay/intro offset.
  useEffect(() => {
    if (!playing) return;
    if (!track.durationSec) return;
    const ms = (track.durationSec + 3) * 1000;
    const id = window.setTimeout(() => {
      if (endedFiredRef.current) return;
      endedFiredRef.current = true;
      onEndedRef.current();
    }, ms);
    return () => window.clearTimeout(id);
  }, [track.id, track.durationSec, playing]);

  // Bare embed URL - matching the snippet niconico's share menu emits.
  // Adding query params (jsapi, playerId, continuous, etc.) tends to activate
  // origin-restricted code paths and surface the "プレーヤーを更新…" error.
  const src = `https://embed.nicovideo.jp/watch/${encodeURIComponent(track.externalId)}`;

  return (
    <iframe
      key={track.id}
      src={src}
      className="absolute inset-0 w-full h-full"
      allow="autoplay; encrypted-media; fullscreen"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}
