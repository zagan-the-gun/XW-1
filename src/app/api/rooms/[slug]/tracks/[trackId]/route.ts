import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  forbiddenResponse,
  isAuthorizedForRoom,
  isSameOriginRequest,
  unauthorizedResponse,
} from "@/lib/room-auth-server";

const PatchTrackSchema = z.object({
  status: z.enum(["QUEUED", "PLAYING", "PLAYED", "SKIPPED"]).optional(),
  position: z.number().int().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string; trackId: string }> },
) {
  if (!isSameOriginRequest(req)) return forbiddenResponse();
  const { slug, trackId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchTrackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const room = await prisma.room.findUnique({ where: { slug } });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!(await isAuthorizedForRoom(slug, room.passcode))) return unauthorizedResponse();

  const updated = await prisma.track.update({
    where: { id: trackId },
    data: parsed.data,
  });
  return NextResponse.json({ track: updated });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string; trackId: string }> },
) {
  if (!isSameOriginRequest(req)) return forbiddenResponse();
  const { slug, trackId } = await params;
  const room = await prisma.room.findUnique({ where: { slug } });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!(await isAuthorizedForRoom(slug, room.passcode))) return unauthorizedResponse();

  await prisma.track.delete({ where: { id: trackId } });
  return NextResponse.json({ ok: true });
}
