"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type ShareDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  url: string;
};

export function ShareDialog({ open, onClose, title, url }: ShareDialogProps) {
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      setCanNativeShare(true);
    }
  }, []);

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

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else if (inputRef.current) {
        inputRef.current.select();
        document.execCommand("copy");
      }
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard unavailable; user can still select the text manually.
    }
  }, [url]);

  const handleNativeShare = useCallback(async () => {
    try {
      await navigator.share({ title, url });
    } catch {
      // User cancelled the share sheet, or share failed silently.
    }
  }, [title, url]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-dialog-title"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-card/95 shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 id="share-dialog-title" className="text-base font-semibold">
            ルームを共有
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
          <div className="flex items-center justify-center">
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG value={url} size={176} level="M" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              ルームURL
            </label>
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={url}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="shrink-0 h-10"
                aria-live="polite"
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
          </div>

          {canNativeShare && (
            <Button
              variant="primary"
              size="md"
              onClick={handleNativeShare}
              className="w-full"
            >
              <Share2 className="h-4 w-4" />
              他のアプリで共有
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
