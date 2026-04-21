import { detectPlatform, type DetectedPlatform } from "./platform";

export type TrackMetadata = {
  platform: DetectedPlatform["platform"];
  externalId: string;
  url: string;
  title: string;
  thumbnail: string | null;
  durationSec: number | null;
};

type OEmbedResponse = {
  title?: string;
  thumbnail_url?: string;
  // Some providers (Vimeo / Wistia) return duration in seconds.
  duration?: number;
};

async function fetchOEmbed(url: string): Promise<OEmbedResponse | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 Jukebox" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as OEmbedResponse;
  } catch {
    return null;
  }
}

async function fetchNicoMeta(id: string): Promise<{ title: string | null; thumbnail: string | null; durationSec: number | null }> {
  try {
    const res = await fetch(`https://ext.nicovideo.jp/api/getthumbinfo/${id}`, {
      headers: { "user-agent": "Mozilla/5.0 Jukebox" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { title: null, thumbnail: null, durationSec: null };
    const xml = await res.text();
    const title = xml.match(/<title>([^<]+)<\/title>/)?.[1] ?? null;
    const thumbnail = xml.match(/<thumbnail_url>([^<]+)<\/thumbnail_url>/)?.[1] ?? null;
    const lengthStr = xml.match(/<length>([^<]+)<\/length>/)?.[1] ?? null;
    let durationSec: number | null = null;
    if (lengthStr) {
      const [m, s] = lengthStr.split(":").map(Number);
      if (!Number.isNaN(m) && !Number.isNaN(s)) durationSec = m * 60 + s;
    }
    return { title, thumbnail, durationSec };
  } catch {
    return { title: null, thumbnail: null, durationSec: null };
  }
}

export async function fetchMetadata(rawUrl: string): Promise<TrackMetadata | null> {
  const detected = detectPlatform(rawUrl);
  if (!detected) return null;

  if (detected.platform === "YOUTUBE") {
    const oembed = await fetchOEmbed(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(detected.normalizedUrl)}`,
    );
    return {
      platform: detected.platform,
      externalId: detected.externalId,
      url: detected.normalizedUrl,
      title: oembed?.title ?? `YouTube: ${detected.externalId}`,
      thumbnail: oembed?.thumbnail_url ?? `https://i.ytimg.com/vi/${detected.externalId}/hqdefault.jpg`,
      durationSec: null,
    };
  }

  if (detected.platform === "SOUNDCLOUD") {
    const oembed = await fetchOEmbed(
      `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(detected.normalizedUrl)}`,
    );
    return {
      platform: detected.platform,
      externalId: detected.externalId,
      url: detected.normalizedUrl,
      title: oembed?.title ?? `SoundCloud: ${detected.externalId}`,
      thumbnail: oembed?.thumbnail_url ?? null,
      durationSec: null,
    };
  }

  if (detected.platform === "NICONICO") {
    const meta = await fetchNicoMeta(detected.externalId);
    return {
      platform: detected.platform,
      externalId: detected.externalId,
      url: detected.normalizedUrl,
      title: meta.title ?? `ニコニコ動画: ${detected.externalId}`,
      thumbnail: meta.thumbnail,
      durationSec: meta.durationSec,
    };
  }

  if (detected.platform === "VIMEO") {
    const oembed = await fetchOEmbed(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(detected.normalizedUrl)}`,
    );
    return {
      platform: detected.platform,
      externalId: detected.externalId,
      url: detected.normalizedUrl,
      title: oembed?.title ?? `Vimeo: ${detected.externalId}`,
      thumbnail: oembed?.thumbnail_url ?? null,
      durationSec: typeof oembed?.duration === "number" ? oembed.duration : null,
    };
  }

  if (detected.platform === "WISTIA") {
    const oembed = await fetchOEmbed(
      `https://fast.wistia.com/oembed.json?url=${encodeURIComponent(detected.normalizedUrl)}`,
    );
    return {
      platform: detected.platform,
      externalId: detected.externalId,
      url: detected.normalizedUrl,
      title: oembed?.title ?? `Wistia: ${detected.externalId}`,
      thumbnail: oembed?.thumbnail_url ?? null,
      durationSec: typeof oembed?.duration === "number" ? Math.round(oembed.duration) : null,
    };
  }

  return null;
}
