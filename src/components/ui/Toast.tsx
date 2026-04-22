"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ToastItem = {
  id: number;
  message: string;
  icon?: React.ReactNode;
  tone?: "default" | "info" | "success" | "warning";
};

type ToasterProps = {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
  autoDismissMs?: number;
};

const toneClass: Record<NonNullable<ToastItem["tone"]>, string> = {
  default: "bg-card/95 border-border",
  info: "bg-primary/15 border-primary/40 text-primary-foreground",
  success: "bg-green-500/15 border-green-400/40 text-green-100",
  warning: "bg-amber-500/15 border-amber-400/40 text-amber-100",
};

export function Toaster({ toasts, onDismiss, autoDismissMs = 4000 }: ToasterProps) {
  return (
    <div
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[min(92vw,360px)] pointer-events-none"
      role="region"
      aria-label="通知"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={onDismiss} autoDismissMs={autoDismissMs} />
      ))}
    </div>
  );
}

function ToastRow({
  toast,
  onDismiss,
  autoDismissMs,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
  autoDismissMs: number;
}) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 10);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), autoDismissMs);
    return () => clearTimeout(t);
  }, [toast.id, autoDismissMs, onDismiss]);

  return (
    <div
      className={cn(
        "pointer-events-auto rounded-xl border shadow-lg px-4 py-3 text-sm backdrop-blur-sm transition-all duration-200",
        entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
        toneClass[toast.tone ?? "default"],
      )}
      role="status"
    >
      <div className="flex items-start gap-2">
        {toast.icon && <span className="shrink-0 mt-0.5">{toast.icon}</span>}
        <p className="flex-1">{toast.message}</p>
      </div>
    </div>
  );
}

export function useToaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // 同一 tick の連続 push でも一意性を保証するため useRef で増分 id を保持。
  const nextIdRef = useRef(0);

  const push = useCallback((toast: Omit<ToastItem, "id">) => {
    nextIdRef.current += 1;
    const id = nextIdRef.current;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, push, dismiss };
}
