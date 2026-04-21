"use client";

import { Trash2, Play, Music } from "lucide-react";
import type { Track } from "@prisma/client";
import { formatDuration } from "@/lib/utils";

type Props = {
  tracks: Track[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onRemove: (trackId: string) => void;
};

export function QueueList({ tracks, currentIndex, onSelect, onRemove }: Props) {
  if (tracks.length === 0) {
    return <p className="text-sm text-muted-foreground">キューは空です</p>;
  }
  return (
    <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto -mx-1 pr-1">
      {tracks.map((t, i) => {
        const isCurrent = i === currentIndex;
        const isPlayed = t.status === "PLAYED" || t.status === "SKIPPED";
        return (
          <li
            key={t.id}
            className={`group relative flex items-center gap-3 rounded-lg px-2 py-2 transition-colors ${
              isCurrent
                ? "bg-primary/15 ring-1 ring-primary/40"
                : "hover:bg-white/5"
            } ${isPlayed ? "opacity-50" : ""}`}
          >
            <button
              type="button"
              onClick={() => onSelect(i)}
              className="flex items-center gap-3 flex-1 min-w-0 text-left"
              title="この曲を再生"
            >
              <div className="relative h-12 w-12 shrink-0 rounded-md overflow-hidden bg-black/40 flex items-center justify-center">
                {t.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.thumbnail}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <Music className="h-5 w-5 text-muted-foreground" />
                )}
                {isCurrent && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Play className="h-4 w-4 text-primary" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{t.title}</div>
                <div className="text-xs text-muted-foreground">
                  {platformLabel(t.platform)}
                  {t.durationSec ? ` ・ ${formatDuration(t.durationSec)}` : ""}
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => onRemove(t.id)}
              className="shrink-0 p-2 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              aria-label="キューから削除"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        );
      })}
    </ul>
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
