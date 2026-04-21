import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateRoomSlug } from "@/lib/slug";

const CreateRoomSchema = z.object({
  name: z.string().min(1).max(80),
  isPublic: z.boolean().default(false),
});

export async function GET() {
  const rooms = await prisma.room.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: { _count: { select: { tracks: true } } },
  });
  return NextResponse.json({ rooms });
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

  const room = await prisma.room.create({
    data: {
      name: parsed.data.name,
      slug,
      isPublic: parsed.data.isPublic,
    },
  });

  return NextResponse.json({ room }, { status: 201 });
}
