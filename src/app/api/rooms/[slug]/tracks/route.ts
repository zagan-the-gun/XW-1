import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fetchMetadata } from "@/lib/metadata";

const AddTrackSchema = z.object({
  url: z.string().url(),
  insertAfterTrackId: z.string().optional(),
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

  const meta = await fetchMetadata(parsed.data.url);
  if (!meta) {
    return NextResponse.json(
      { error: "対応していないURLです（YouTube / SoundCloud / ニコニコ動画のみ）" },
      { status: 400 },
    );
  }

  const track = await prisma.$transaction(async (tx) => {
    const anchorId = parsed.data.insertAfterTrackId;
    if (anchorId) {
      const anchor = await tx.track.findFirst({
        where: { id: anchorId, roomId: room.id },
      });
      if (anchor) {
        // Find the end of the contiguous "QUEUED" run right after the anchor.
        // Newly inserted tracks stack up after the anchor in arrival order so
        // that A, B, C added while X plays become [X, A, B, C, ...].
        const following = await tx.track.findMany({
          where: { roomId: room.id, position: { gt: anchor.position } },
          orderBy: { position: "asc" },
        });
        let insertPos = anchor.position + 1;
        for (const t of following) {
          if (t.status === "QUEUED") {
            insertPos = t.position + 1;
          } else {
            break;
          }
        }
        await tx.track.updateMany({
          where: { roomId: room.id, position: { gte: insertPos } },
          data: { position: { increment: 1 } },
        });
        return tx.track.create({
          data: {
            roomId: room.id,
            url: meta.url,
            platform: meta.platform,
            externalId: meta.externalId,
            title: meta.title,
            thumbnail: meta.thumbnail,
            durationSec: meta.durationSec,
            position: insertPos,
          },
        });
      }
    }

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
