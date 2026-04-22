"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, KeyRound, Lock, RefreshCw, Unlock, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

type Props = {
  open: boolean;
  onClose: () => void;
  slug: string;
  passcode: string | null;
  onChanged: (next: string | null) => void;
};

export function PasscodeDialog({ open, onClose, slug, passcode, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setCopied(false);
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const patch = useCallback(
    async (body: Record<string, unknown>): Promise<string | null | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/rooms/${slug}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          setError("操作に失敗しました");
          return undefined;
        }
        const data = (await res.json()) as { room: { passcode: string | null } };
        return data.room.passcode;
      } catch {
        setError("ネットワークエラーが発生しました");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [slug],
  );

  const handleRegenerate = useCallback(async () => {
    const next = await patch({ passcode: "regenerate" });
    if (next !== undefined) onChanged(next);
  }, [patch, onChanged]);

  const handleRemove = useCallback(async () => {
    const next = await patch({ passcode: null });
    if (next !== undefined) onChanged(next);
  }, [patch, onChanged]);

  const handleCopy = useCallback(async () => {
    if (!passcode) return;
    try {
      await navigator.clipboard.writeText(passcode);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  }, [passcode]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="passcode-dialog-title"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-card/95 shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 id="passcode-dialog-title" className="text-base font-semibold inline-flex items-center gap-2">
            {passcode ? <Lock className="h-4 w-4 text-primary" /> : <Unlock className="h-4 w-4 text-muted-foreground" />}
            ルームパスコード
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {passcode ? (
            <>
              <p className="text-sm text-muted-foreground">
                現在のパスコードです。外部から入室する人に共有してください。
              </p>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-black/40 px-4 py-3">
                <span className="font-mono text-2xl tracking-[0.4em] select-all">
                  {passcode}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  aria-live="polite"
                  className="shrink-0"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4" />
                      コピー済
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      コピー
                    </>
                  )}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={handleRegenerate}
                  disabled={busy}
                >
                  <RefreshCw className="h-4 w-4" />
                  再生成
                </Button>
                <Button
                  variant="danger"
                  onClick={handleRemove}
                  disabled={busy}
                >
                  <Unlock className="h-4 w-4" />
                  鍵を外す
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                再生成/解除すると、このルームにいる全員のパスコードが同時に更新されます。既存メンバーは入り直し不要です。
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                このルームには現在パスコードが設定されていません。鍵をかけると、URL を知っていてもパスコードが無ければ入室できなくなります。
              </p>
              <Button
                variant="primary"
                onClick={handleRegenerate}
                disabled={busy}
                className="w-full"
              >
                <KeyRound className="h-4 w-4" />
                {busy ? "設定中..." : "パスコードを設定する"}
              </Button>
            </>
          )}

          {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  );
}
