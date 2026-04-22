import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateRoomSlug } from "@/lib/slug";
import { RoomPasscodeSchema, generateRoomPasscode } from "@/lib/passcode";
import { buildSetPasscodeCookie } from "@/lib/room-auth";

// passcode を直接受け取るのは、作成フォームがクライアント側で事前生成したものを
// 「表示したパスコードと作ったルームのパスコードが一致」させたいため。
// 省略時は withPasscode:true のフォールバックでサーバ側生成する。
const CreateRoomSchema = z.object({
  name: z.string().min(1).max(80),
  isPublic: z.boolean().default(false),
  withPasscode: z.boolean().default(false),
  passcode: RoomPasscodeSchema.optional(),
});

export async function GET() {
  const rooms = await prisma.room.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: { _count: { select: { tracks: true } } },
  });

  const redacted = rooms.map(({ passcode, ...rest }) => ({
    ...rest,
    hasPasscode: Boolean(passcode),
  }));

  return NextResponse.json({ rooms: redacted });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = CreateRoomSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let slug = generateRoomSlug();
  for (let i = 0; i < 5; i++) {
    const existing = await prisma.room.findUnique({ where: { slug } });
    if (!existing) break;
    slug = generateRoomSlug();
  }

  let passcode: string | null = null;
  if (parsed.data.passcode) {
    passcode = parsed.data.passcode;
  } else if (parsed.data.withPasscode) {
    passcode = generateRoomPasscode();
  }

  const room = await prisma.room.create({
    data: {
      name: parsed.data.name,
      slug,
      isPublic: parsed.data.isPublic,
      passcode,
    },
  });

  const res = NextResponse.json(
    {
      room: {
        id: room.id,
        name: room.name,
        slug: room.slug,
        hostId: room.hostId,
        isPublic: room.isPublic,
        loopPlayback: room.loopPlayback,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
        hasPasscode: Boolean(passcode),
      },
      passcode,
    },
    { status: 201 },
  );
  if (passcode) {
    res.headers.append("Set-Cookie", buildSetPasscodeCookie(slug, passcode));
  }
  return res;
}
