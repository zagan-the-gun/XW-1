import type { Platform } from "@prisma/client";

export type DetectedPlatform = {
  platform: Platform;
  externalId: string;
  normalizedUrl: string;
};

export function detectPlatform(rawUrl: string): DetectedPlatform | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    if (!id) return null;
    return {
      platform: "YOUTUBE",
      externalId: id,
      normalizedUrl: `https://www.youtube.com/watch?v=${id}`,
    };
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const id = url.searchParams.get("v");
    if (!id) return null;
    return {
      platform: "YOUTUBE",
      externalId: id,
      normalizedUrl: `https://www.youtube.com/watch?v=${id}`,
    };
  }

  if (host === "soundcloud.com" || host === "m.soundcloud.com") {
    const cleanPath = url.pathname.replace(/\/+$/, "");
    if (!cleanPath) return null;
    return {
      platform: "SOUNDCLOUD",
      externalId: cleanPath,
      normalizedUrl: `https://soundcloud.com${cleanPath}`,
    };
  }

  if (host === "nicovideo.jp" || host === "sp.nicovideo.jp" || host === "www.nicovideo.jp") {
    const match = url.pathname.match(/\/watch\/([a-z0-9]+)/i);
    if (!match) return null;
    const id = match[1];
    return {
      platform: "NICONICO",
      externalId: id,
      normalizedUrl: `https://www.nicovideo.jp/watch/${id}`,
    };
  }

  if (host === "nico.ms") {
    const id = url.pathname.replace(/^\//, "").split("/")[0];
    if (!id) return null;
    return {
      platform: "NICONICO",
      externalId: id,
      normalizedUrl: `https://www.nicovideo.jp/watch/${id}`,
    };
  }

  // Vimeo: vimeo.com/<id>, vimeo.com/channels/<x>/<id>,
  //        vimeo.com/groups/<x>/videos/<id>, player.vimeo.com/video/<id>
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const segments = url.pathname.split("/").filter(Boolean);
    const id = segments.reverse().find((s) => /^\d+$/.test(s));
    if (!id) return null;
    return {
      platform: "VIMEO",
      externalId: id,
      normalizedUrl: `https://vimeo.com/${id}`,
    };
  }

  // Wistia: <account>.wistia.com/medias/<hash>,
  //         fast.wistia.com/embed/medias/<hash>.jsonp,
  //         fast.wistia.net/embed/iframe/<hash>
  if (host.endsWith(".wistia.com") || host === "wistia.com" || host.endsWith(".wistia.net")) {
    const match = url.pathname.match(/\/(?:medias|embed\/medias|embed\/iframe)\/([a-z0-9]+)/i);
    if (!match) return null;
    const id = match[1].replace(/\.jsonp$/, "");
    return {
      platform: "WISTIA",
      externalId: id,
      normalizedUrl: `https://fast.wistia.net/embed/iframe/${id}`,
    };
  }

  return null;
}
