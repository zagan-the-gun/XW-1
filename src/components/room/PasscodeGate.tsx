"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

type Props = {
  slug: string;
  roomName: string;
};

export function PasscodeGate({ slug, roomName }: Props) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(normalized)) {
      setError("6桁の英数字を入力してください");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${slug}/auth`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: normalized }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      if (res.status === 401) {
        setError("パスコードが違います");
      } else {
        setError("入室に失敗しました");
      }
    } catch {
      setError("ネットワークエラーが発生しました");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-col items-center text-center gap-4">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Lock className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-semibold">{roomName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            このルームはパスコードが必要です
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="passcode-input" className="block text-xs font-medium text-muted-foreground mb-1.5">
            パスコード
          </label>
          <Input
            id="passcode-input"
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            placeholder="例: A1B2C3"
            maxLength={6}
            autoFocus
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono tracking-[0.3em] text-center text-lg"
          />
        </div>

        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

        <Button type="submit" disabled={pending} className="w-full">
          <KeyRound className="h-4 w-4" />
          {pending ? "確認中..." : "入室"}
        </Button>
      </form>
    </Card>
  );
}
