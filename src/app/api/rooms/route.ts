import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateRoomSlug } from "@/lib/slug";
import { RoomPasscodeSchema, generateRoomPasscode } from "@/lib/passcode";
import { buildSetPasscodeCookie } from "@/lib/room-auth";
import { forbiddenResponse, isSameOriginRequest } from "@/lib/room-auth-server";
import { MAX_ROOMS_TOTAL } from "@/lib/constants";

// passcode を直接受け取るのは、作成フォームがクライアント側で事前生成したものを
// 「表示したパスコードと作ったルームのパスコードが一致」させたいため。
// 省略時は withPasscode:true のフォールバックでサーバ側生成する。
const CreateRoomSchema = z.object({
  name: z.string().min(1).max(80),
  withPasscode: z.boolean().default(false),
  passcode: RoomPasscodeSchema.optional(),
});

// 一覧 API は鍵なしルーム (passcode IS NULL) のみ返す。
// 鍵付きルームは「URL を共有された人だけが入る」想定なので、名前と slug を露出させない。
export async function GET() {
  const rooms = await prisma.room.findMany({
    where: { passcode: null },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: { _count: { select: { tracks: true } } },
  });

  // 念のため passcode フィールドはレスポンスから落とす（フィルタしているので常に null だが、防御的に）。
  const redacted = rooms.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    hostId: r.hostId,
    loopPlayback: r.loopPlayback,
    shufflePlayback: r.shufflePlayback,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    lastOccupiedAt: r.lastOccupiedAt,
    _count: r._count,
    hasPasscode: false,
  }));

  return NextResponse.json({ rooms: redacted });
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return forbiddenResponse();
  const body = await req.json().catch(() => null);
  const parsed = CreateRoomSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // ソフトリミット: count → create 間の競合で 1〜2 件超過する可能性は許容
  // (DoS 緩和が目的で、厳密な上限ではない)。
  const roomCount = await prisma.room.count();
  if (roomCount >= MAX_ROOMS_TOTAL) {
    return NextResponse.json(
      { error: `ルームの上限 ${MAX_ROOMS_TOTAL} 件に達しています。しばらく経ってから再度お試しください。` },
      { status: 409 },
    );
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
