import Link from "next/link";
import { Disc3, Home } from "lucide-react";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex items-center gap-3 text-primary">
        <Disc3 className="h-8 w-8 animate-[spin_6s_linear_infinite] opacity-60" />
        <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
          Dead Beef Saloon
        </span>
      </div>

      <div className="mt-8 font-mono text-6xl sm:text-7xl font-bold text-primary">
        0x404
      </div>

      <h1 className="mt-4 text-2xl sm:text-3xl font-bold">
        この部屋は見つからなかった
      </h1>

      <p className="mt-4 text-muted-foreground max-w-md">
        店じまい済みの酒場か、そもそも存在しなかったかのどちらかです。
        <br />
        URLをもう一度確認するか、カウンターで別の一杯を頼んでください。
      </p>

      <Link
        href="/"
        className="mt-10 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:brightness-110 active:brightness-95 shadow-[0_8px_30px_-10px_hsl(var(--primary))] focus:outline-none focus:ring-2 focus:ring-primary/50"
      >
        <Home className="h-4 w-4" />
        酒場のエントランスへ戻る
      </Link>
    </main>
  );
}
