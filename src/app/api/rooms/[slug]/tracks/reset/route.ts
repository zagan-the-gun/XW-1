import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  forbiddenResponse,
  isAuthorizedForRoom,
  isSameOriginRequest,
  unauthorizedResponse,
} from "@/lib/room-auth-server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!isSameOriginRequest(req)) return forbiddenResponse();
  const { slug } = await params;
  const room = await prisma.room.findUnique({ where: { slug } });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!(await isAuthorizedForRoom(slug, room.passcode))) return unauthorizedResponse();

  await prisma.track.updateMany({
    where: { roomId: room.id, status: { in: ["PLAYED", "SKIPPED"] } },
    data: { status: "QUEUED" },
  });

  const tracks = await prisma.track.findMany({
    where: { roomId: room.id },
    orderBy: { position: "asc" },
  });

  return NextResponse.json({ tracks });
}
