import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { passcodeCookieName } from "@/lib/room-auth";
import { RoomClient } from "@/components/room/RoomClient";
import { PasscodeGate } from "@/components/room/PasscodeGate";

export const dynamic = "force-dynamic";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const room = await prisma.room.findUnique({
    where: { slug },
    include: { tracks: { orderBy: { position: "asc" } } },
  });
  if (!room) return notFound();

  if (room.passcode) {
    const store = await cookies();
    const cookieValue = store.get(passcodeCookieName(slug))?.value;
    if (cookieValue !== room.passcode) {
      return (
        <main className="mx-auto max-w-lg px-3 sm:px-4 py-8 sm:py-16">
          <div className="mb-4">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              ホームに戻る
            </Link>
          </div>
          <PasscodeGate slug={slug} roomName={room.name} />
        </main>
      );
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-3 sm:px-4 py-4 sm:py-8">
      <div className="mb-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          ホームに戻る
        </Link>
      </div>
      <RoomClient initialRoom={{ ...room, tracks: room.tracks }} />
    </main>
  );
}
