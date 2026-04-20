import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const PatchTrackSchema = z.object({
  status: z.enum(["QUEUED", "PLAYING", "PLAYED", "SKIPPED"]).optional(),
  position: z.number().int().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string; trackId: string }> },
) {
  const { slug, trackId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchTrackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const room = await prisma.room.findUnique({ where: { slug } });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const updated = await prisma.track.update({
    where: { id: trackId },
    data: parsed.data,
  });
  return NextResponse.json({ track: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string; trackId: string }> },
) {
  const { slug, trackId } = await params;
  const room = await prisma.room.findUnique({ where: { slug } });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  await prisma.track.delete({ where: { id: trackId } });
  return NextResponse.json({ ok: true });
}
