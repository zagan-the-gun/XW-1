import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { RoomPasscodeSchema } from "@/lib/passcode";
import { buildClearPasscodeCookie, buildSetPasscodeCookie } from "@/lib/room-auth";

const AuthSchema = z.object({
  passcode: RoomPasscodeSchema,
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await req.json().catch(() => null);
  const parsed = AuthSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const room = await prisma.room.findUnique({ where: { slug } });
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  if (!room.passcode) {
    return NextResponse.json({ error: "Room has no passcode" }, { status: 400 });
  }

  if (parsed.data.passcode !== room.passcode) {
    return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", buildSetPasscodeCookie(slug, room.passcode));
  return res;
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", buildClearPasscodeCookie(slug));
  return res;
}
