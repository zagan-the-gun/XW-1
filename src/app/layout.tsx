import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dead Beef Saloon — 死んだ牛の酒場",
  description:
    "0xDEADBEEF。YouTube / SoundCloud / ニコニコ動画 / Vimeo / Wistia のURLを投げ込んで、仲間とひと晩のBGMを持ち寄るジュークボックス酒場。",
  openGraph: {
    title: "Dead Beef Saloon — 死んだ牛の酒場",
    description:
      "0xDEADBEEF。URLを一本投げ込めば、今夜の一曲が始まる。YouTube / SoundCloud / ニコニコ動画 / Vimeo / Wistia 対応の共有ジュークボックス。",
    siteName: "Dead Beef Saloon",
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Dead Beef Saloon — 死んだ牛の酒場",
    description:
      "0xDEADBEEF。URLを一本投げ込めば、今夜の一曲が始まる共有ジュークボックス。",
  },
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
