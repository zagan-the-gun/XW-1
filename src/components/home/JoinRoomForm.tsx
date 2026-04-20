"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function JoinRoomForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = code.trim();
    if (!trimmed) {
      setError("ルームコードを入力してください");
      return;
    }
    let slug = trimmed;
    try {
      const url = new URL(trimmed);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "room" && parts[1]) slug = parts[1];
    } catch {
      // not a URL
    }
    router.push(`/room/${slug}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-medium block mb-1.5">ルームコード または URL</label>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="例: abc12xyz"
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" variant="outline" className="w-full">
        参加する
      </Button>
    </form>
  );
}
