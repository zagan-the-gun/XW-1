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
    ],
  },
};

export default nextConfig;
