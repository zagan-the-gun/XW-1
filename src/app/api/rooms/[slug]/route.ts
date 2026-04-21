import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const PatchRoomSchema = z.object({
  loopPlayback: z.boolean().optional(),
  name: z.string().min(1).max(80).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const room = await prisma.room.findUnique({
    where: { slug },
    include: {
      tracks: {
        orderBy: { position: "asc" },
      },
    },
  });
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  return NextResponse.json({ room });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchRoomSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const room = await prisma.room.findUnique({ where: { slug } });
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  const updated = await prisma.room.update({
    where: { id: room.id },
    data: parsed.data,
  });
  return NextResponse.json({ room: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const room = await prisma.room.findUnique({ where: { slug } });
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  await prisma.room.delete({ where: { id: room.id } });
  return NextResponse.json({ ok: true });
}
