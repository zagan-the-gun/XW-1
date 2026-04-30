import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// "Jump" by clicking a queue row: rewrite statuses so that everything before
// the target becomes PLAYED and the target itself + everything after become
// QUEUED. The actual playback start is driven by the client (currentIndex +
// emit("play")); this endpoint only owns the persistent queue state.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string; trackId: string }> },
) {
  const { slug, trackId } = await params;
  const room = await prisma.room.findUnique({ where: { slug } });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const target = await prisma.track.findFirst({
    where: { id: trackId, roomId: room.id },
  });
  if (!target) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.track.updateMany({
      where: { roomId: room.id, position: { lt: target.position } },
      data: { status: "PLAYED" },
    }),
    prisma.track.updateMany({
      where: { roomId: room.id, position: { gte: target.position } },
      data: { status: "QUEUED" },
    }),
  ]);

  const tracks = await prisma.track.findMany({
    where: { roomId: room.id },
    orderBy: { position: "asc" },
  });

  return NextResponse.json({ tracks });
}
