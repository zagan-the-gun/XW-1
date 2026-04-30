import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fetchMetadata } from "@/lib/metadata";
import { MAX_TRACKS_PER_ROOM } from "@/lib/constants";

const AddTrackSchema = z.object({
  url: z.string().url(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const room = await prisma.room.findUnique({ where: { slug } });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const tracks = await prisma.track.findMany({
    where: { roomId: room.id },
    orderBy: { position: "asc" },
  });
  return NextResponse.json({ tracks });
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await req.json().catch(() => null);
  const parsed = AddTrackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const room = await prisma.room.findUnique({ where: { slug } });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // Cap total tracks (including PLAYED/SKIPPED) before touching the external
  // oEmbed APIs so the limit also protects us from metadata-fetch abuse.
  const trackCount = await prisma.track.count({ where: { roomId: room.id } });
  if (trackCount >= MAX_TRACKS_PER_ROOM) {
    return NextResponse.json(
      { error: `ルームのキューは ${MAX_TRACKS_PER_ROOM} 件までです` },
      { status: 409 },
    );
  }

  const meta = await fetchMetadata(parsed.data.url);
  if (!meta) {
    return NextResponse.json(
      { error: "対応していないURLです（YouTube / SoundCloud / ニコニコ動画 / Vimeo / Wistia）" },
      { status: 400 },
    );
  }

  const track = await prisma.$transaction(async (tx) => {
    const last = await tx.track.findFirst({
      where: { roomId: room.id },
      orderBy: { position: "desc" },
    });
    const position = (last?.position ?? -1) + 1;
    return tx.track.create({
      data: {
        roomId: room.id,
        url: meta.url,
        platform: meta.platform,
        externalId: meta.externalId,
        title: meta.title,
        thumbnail: meta.thumbnail,
        durationSec: meta.durationSec,
        position,
      },
    });
  });

  await prisma.room.update({ where: { id: room.id }, data: { updatedAt: new Date() } });

  return NextResponse.json({ track }, { status: 201 });
}
