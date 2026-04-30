import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateRoomPasscode } from "@/lib/passcode";
import {
  buildClearPasscodeCookie,
  buildSetPasscodeCookie,
  passcodeCookieName,
} from "@/lib/room-auth";

const PatchRoomSchema = z.object({
  loopPlayback: z.boolean().optional(),
  shufflePlayback: z.boolean().optional(),
  name: z.string().min(1).max(80).optional(),
  // "regenerate" で新規生成または再生成、null で鍵を外す。省略時は変更しない。
  passcode: z.union([z.literal("regenerate"), z.null()]).optional(),
});

async function readPasscodeCookie(slug: string) {
  const store = await cookies();
  return store.get(passcodeCookieName(slug))?.value;
}

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

  const cookieValue = await readPasscodeCookie(slug);
  const authenticated = !room.passcode || cookieValue === room.passcode;
  if (room.passcode && !authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // authenticated のときだけ passcode を露出する（未認証は上で早期 return しているので常に露出可）。
  return NextResponse.json({
    room: { ...room, hasPasscode: Boolean(room.passcode) },
  });
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

  const cookieValue = await readPasscodeCookie(slug);
  const isRoomMember = !room.passcode || cookieValue === room.passcode;

  // 鍵ありルームの操作は Cookie 認証必須。鍵なしルームへの初回設定だけは誰でも可。
  if (room.passcode && !isRoomMember) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let nextPasscode: string | null | undefined = undefined;
  if (parsed.data.passcode === "regenerate") {
    nextPasscode = generateRoomPasscode();
  } else if (parsed.data.passcode === null) {
    nextPasscode = null;
  }

  const updated = await prisma.room.update({
    where: { id: room.id },
    data: {
      ...(parsed.data.loopPlayback !== undefined && { loopPlayback: parsed.data.loopPlayback }),
      ...(parsed.data.shufflePlayback !== undefined && {
        shufflePlayback: parsed.data.shufflePlayback,
      }),
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(nextPasscode !== undefined && { passcode: nextPasscode }),
    },
  });

  const res = NextResponse.json({
    room: { ...updated, hasPasscode: Boolean(updated.passcode) },
  });
  if (nextPasscode === null) {
    res.headers.append("Set-Cookie", buildClearPasscodeCookie(slug));
  } else if (typeof nextPasscode === "string") {
    res.headers.append("Set-Cookie", buildSetPasscodeCookie(slug, nextPasscode));
  }
  return res;
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const room = await prisma.room.findUnique({ where: { slug } });
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  if (room.passcode) {
    const cookieValue = await readPasscodeCookie(slug);
    if (cookieValue !== room.passcode) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  await prisma.room.delete({ where: { id: room.id } });
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", buildClearPasscodeCookie(slug));
  return res;
}
