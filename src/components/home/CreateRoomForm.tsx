"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { generateRoomPasscode } from "@/lib/passcode";

export function CreateRoomForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleToggle = useCallback((checked: boolean) => {
    setPasscode(checked ? generateRoomPasscode() : null);
    setCopied(false);
  }, []);

  const handleRegenerate = useCallback(() => {
    setPasscode(generateRoomPasscode());
    setCopied(false);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!passcode) return;
    try {
      await navigator.clipboard.writeText(passcode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard 使えない環境では無視
    }
  }, [passcode]);

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
      body: JSON.stringify({
        name: name.trim(),
        ...(passcode ? { passcode } : {}),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.toString?.() ?? "ルーム作成に失敗しました");
      return;
    }
    const { room } = (await res.json()) as { room: { slug: string } };
    startTransition(() => {
      router.push(`/room/${room.slug}`);
    });
  }

  const passcodeOn = passcode !== null;

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

      <div className="rounded-lg border border-border bg-black/20 p-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={passcodeOn}
            onCheckedChange={handleToggle}
            aria-labelledby="passcode-toggle-label"
            data-testid="with-passcode-switch"
          />
          <label
            id="passcode-toggle-label"
            htmlFor="with-passcode-switch"
            onClick={() => handleToggle(!passcodeOn)}
            className="inline-flex items-center gap-1.5 text-sm font-medium cursor-pointer select-none"
          >
            <KeyRound className="h-4 w-4 text-primary" />
            パスコードを設定
          </label>

          {passcodeOn && passcode && (
            <div
              className="ml-auto flex items-center gap-2"
              data-testid="passcode-preview"
            >
              <span className="font-mono text-lg tracking-[0.3em] select-all">
                {passcode}
              </span>
              <button
                type="button"
                onClick={handleRegenerate}
                aria-label="パスコードを再生成"
                title="別のパスコードを生成"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleCopy}
                aria-label="パスコードをコピー"
                title={copied ? "コピーしました" : "パスコードをコピー"}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-300" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          )}
        </div>
        {passcodeOn && (
          <p className="text-xs text-muted-foreground mt-2">
            このパスコードを知っている人だけが入室できます。あとからルーム内で再生成・解除も可能です。
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "作成中..." : "ルームを作成"}
      </Button>
    </form>
  );
}
