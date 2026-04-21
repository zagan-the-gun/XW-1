"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function CreateRoomForm() {
  const router = useRouter();
  const [name, setName] = useState("");
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
      body: JSON.stringify({ name: name.trim() }),
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

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "作成中..." : "ルームを作成"}
      </Button>
    </form>
  );
}
