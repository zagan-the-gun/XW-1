import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jukebox — 仲間と流すBGM",
  description:
    "YouTube / SoundCloud / ニコニコ動画を自由にキューに追加できるジュークボックス。作業BGMからパーティまで。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0d14",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="bg-gradient-hero min-h-dvh">{children}</body>
    </html>
  );
}
