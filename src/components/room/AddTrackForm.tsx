"use client";

import { useState } from "react";
import type { Track } from "@prisma/client";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Props = {
  roomSlug: string;
  insertAfterTrackId?: string;
  onAdded: (track: Track) => void;
};

export function AddTrackForm({ roomSlug, insertAfterTrackId, onAdded }: Props) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${roomSlug}/tracks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: trimmed, insertAfterTrackId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "追加に失敗しました");
        return;
      }
      onAdded(data.track as Track);
      setUrl("");
    } catch {
      setError("追加に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="YouTube / SoundCloud / ニコニコ動画 / Vimeo / Wistia のURL"
          inputMode="url"
        />
        <Button type="submit" disabled={loading || !url.trim()} className="sm:w-auto">
          <Plus className="h-4 w-4" />
          {loading ? "追加中..." : "追加"}
        </Button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
