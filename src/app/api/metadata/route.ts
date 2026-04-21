import { NextResponse } from "next/server";
import { fetchMetadata } from "@/lib/metadata";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const url = body?.url;
  if (typeof url !== "string") {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }
  const meta = await fetchMetadata(url);
  if (!meta) {
    return NextResponse.json(
      { error: "対応していないURLです（YouTube / SoundCloud / ニコニコ動画 / Vimeo / Wistia）" },
      { status: 400 },
    );
  }
  return NextResponse.json({ metadata: meta });
}
