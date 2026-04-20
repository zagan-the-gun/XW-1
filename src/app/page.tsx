import Link from "next/link";
import { Disc3, Users, ListMusic, Music2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { CreateRoomForm } from "@/components/home/CreateRoomForm";
import { JoinRoomForm } from "@/components/home/JoinRoomForm";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

async function getRecentRooms() {
  try {
    return await prisma.room.findMany({
      orderBy: { updatedAt: "desc" },
      take: 10,
      include: { _count: { select: { tracks: true } } },
    });
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const rooms = await getRecentRooms();

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:py-16">
      <header className="mb-10 sm:mb-14">
        <div className="flex items-center gap-3 text-primary">
          <Disc3 className="h-7 w-7 sm:h-9 sm:w-9 animate-[spin_6s_linear_infinite]" />
          <span className="text-xs sm:text-sm uppercase tracking-[0.3em] text-muted-foreground">
            Jukebox
          </span>
        </div>
        <h1 className="mt-4 text-3xl sm:text-5xl font-bold leading-tight">
          みんなで流す、
          <br className="sm:hidden" />
          ひとりで浸る、音楽の部屋。
        </h1>
        <p className="mt-4 text-muted-foreground max-w-2xl">
          YouTube / SoundCloud / ニコニコ動画のURLを貼るだけ。自分専用のBGMにも、
          飲み会のジュークボックスにも。
        </p>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-10">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ListMusic className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">新しいルームを作る</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              ソロモードは作業BGM向け。パーティモードはURLを共有して複数人で楽しめます。
            </p>
          </CardHeader>
          <CardBody>
            <CreateRoomForm />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-accent" />
              <h2 className="text-lg font-semibold">ルームに参加</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              ルームコードまたは共有URLから参加できます。
            </p>
          </CardHeader>
          <CardBody>
            <JoinRoomForm />
          </CardBody>
        </Card>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Music2 className="h-5 w-5 text-muted-foreground" />
          最近のルーム
        </h2>
        {rooms.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            まだルームがありません。上のフォームから最初のルームを作ってみましょう。
          </p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rooms.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/room/${r.slug}`}
                  className="block rounded-xl border border-border bg-card/50 hover:bg-card transition-colors p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {r.mode === "PARTY" ? "パーティ" : "ソロ"} ・ {r._count.tracks} 曲
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground font-mono">
                      {r.slug}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
