import { prisma } from "@/lib/prisma";
import { ROOM_CLEANUP_INTERVAL_MS, ROOM_INACTIVITY_TTL_DAYS } from "@/lib/constants";
import { getOccupiedRoomSlugs } from "./socket-handler";

// 空室 TTL。Room.lastOccupiedAt がこの日数以上前 → 参加者 0 人が続いているとみなして削除。
// Track は onDelete: Cascade で一緒に消える。
// 誰かが入室した瞬間と最後の 1 人が退出した瞬間に socket-handler が lastOccupiedAt を今に更新するので、
// 「0 人になってから N 日」＝「lastOccupiedAt が N 日以上前」と等価になる。

export type CleanupResult = {
  touchedOccupiedRooms: number;
  deletedRooms: number;
  thresholdAt: Date;
};

export async function runRoomCleanup(now: Date = new Date()): Promise<CleanupResult> {
  // 1. 現在占有中のルームは lastOccupiedAt を now に更新しておく。
  //    これをしないと「ずっと誰かいるけど誰も join_room を再送していないルーム」が TTL 到達で消える。
  const occupiedSlugs = getOccupiedRoomSlugs();
  let touchedOccupiedRooms = 0;
  if (occupiedSlugs.length > 0) {
    const res = await prisma.room.updateMany({
      where: { slug: { in: occupiedSlugs } },
      data: { lastOccupiedAt: now },
    });
    touchedOccupiedRooms = res.count;
  }

  // 2. TTL 超過のルームを削除。
  const thresholdAt = new Date(now.getTime() - ROOM_INACTIVITY_TTL_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await prisma.room.deleteMany({
    where: { lastOccupiedAt: { lt: thresholdAt } },
  });

  return { touchedOccupiedRooms, deletedRooms: deleted.count, thresholdAt };
}

let timer: NodeJS.Timeout | null = null;

export function startRoomCleanup(options?: { intervalMs?: number; onError?: (e: unknown) => void }) {
  if (timer) return;
  const interval = options?.intervalMs ?? ROOM_CLEANUP_INTERVAL_MS;
  const onError = options?.onError ?? ((e) => console.error("[room-cleanup]", e));

  const tick = async () => {
    try {
      const res = await runRoomCleanup();
      if (res.deletedRooms > 0 || res.touchedOccupiedRooms > 0) {
        console.log(
          `[room-cleanup] touched=${res.touchedOccupiedRooms} deleted=${res.deletedRooms} ttlDays=${ROOM_INACTIVITY_TTL_DAYS}`,
        );
      }
    } catch (e) {
      onError(e);
    }
  };

  // 起動直後に 1 回走らせて、その後は interval ごとに回す。
  void tick();
  timer = setInterval(tick, interval);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopRoomCleanup() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
