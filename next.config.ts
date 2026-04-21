import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
      { protocol: "https", hostname: "i1.sndcdn.com" },
      { protocol: "https", hostname: "nicovideo.cdn.nimg.jp" },
      { protocol: "https", hostname: "tn.smilevideo.jp" },
      { protocol: "https", hostname: "i.vimeocdn.com" },
      { protocol: "https", hostname: "embed-ssl.wistia.com" },
      { protocol: "https", hostname: "embed-fastly.wistia.com" },
      { protocol: "https", hostname: "embedwistia-a.akamaihd.net" },
    ],
  },
  async headers() {
    // 各プラットフォームの埋め込みプレイヤーが要求する機能を許可する。
    // 未指定だと一部ブラウザが encrypted-media / autoplay をブロックし、
    // "Permissions policy violation: encrypted-media is not allowed" が出る。
    const autoplayOrigins = [
      '"https://www.youtube.com"',
      '"https://www.youtube-nocookie.com"',
      '"https://w.soundcloud.com"',
      '"https://embed.nicovideo.jp"',
      '"https://player.vimeo.com"',
      '"https://fast.wistia.net"',
      '"https://fast.wistia.com"',
    ];
    const fullscreenOrigins = autoplayOrigins;
    const encryptedMediaOrigins = [
      '"https://www.youtube.com"',
      '"https://www.youtube-nocookie.com"',
      '"https://player.vimeo.com"',
    ];
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Permissions-Policy",
            value: [
              `autoplay=(self ${autoplayOrigins.join(" ")})`,
              `encrypted-media=(self ${encryptedMediaOrigins.join(" ")})`,
              `fullscreen=(self ${fullscreenOrigins.join(" ")})`,
              "picture-in-picture=(self)",
            ].join(", "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
