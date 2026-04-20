"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function CreateRoomForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"SOLO" | "PARTY">("SOLO");
  const [playbackMode, setPlaybackMode] = useState<"HOST" | "SYNC">("HOST");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("ルーム名を入力してください");
      return;
    }
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), mode, playbackMode }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.toString?.() ?? "ルーム作成に失敗しました");
      return;
    }
    const { room } = await res.json();
    startTransition(() => {
      router.push(`/room/${room.slug}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-medium block mb-1.5">ルーム名</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="金曜夜のBGM"
          maxLength={80}
        />
      </div>

      <div>
        <label className="text-sm font-medium block mb-1.5">モード</label>
        <div className="grid grid-cols-2 gap-2">
          <ModeTile
            active={mode === "SOLO"}
            onClick={() => setMode("SOLO")}
            title="ソロ"
            desc="自分だけのBGM"
          />
          <ModeTile
            active={mode === "PARTY"}
            onClick={() => setMode("PARTY")}
            title="パーティ"
            desc="複数人で共有"
          />
        </div>
      </div>

      {mode === "PARTY" && (
        <div>
          <label className="text-sm font-medium block mb-1.5">再生方式</label>
          <div className="grid grid-cols-2 gap-2">
            <ModeTile
              active={playbackMode === "HOST"}
              onClick={() => setPlaybackMode("HOST")}
              title="ホスト再生"
              desc="1台で再生"
            />
            <ModeTile
              active={playbackMode === "SYNC"}
              onClick={() => setPlaybackMode("SYNC")}
              title="同期再生"
              desc="各自のブラウザで"
            />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "作成中..." : "ルームを作成"}
      </Button>
    </form>
  );
}

function ModeTile({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
        active
          ? "border-primary/70 bg-primary/10"
          : "border-border bg-black/20 hover:bg-black/30"
      }`}
    >
      <div className="font-medium text-sm">{title}</div>
      <div className="text-xs text-muted-foreground">{desc}</div>
    </button>
  );
}
