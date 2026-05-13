import type { Server as SocketIOServer, Socket } from "socket.io";
import { prisma } from "@/lib/prisma";
import { verifyPasscodeFromCookieHeader } from "@/lib/room-auth";

type JoinPayload = { roomSlug: string; userName: string };
type AddTrackPayload = { roomSlug: string; trackId: string };
type PlaybackPayload = { roomSlug: string; trackId?: string; positionSec?: number };

type Participant = { socketId: string; name: string };

// 1 socket = 1 ルームの参加状態。`join_room` で確立し、`leave_room` / `disconnect` で破棄する。
// 全 emit 系イベントはこの session を参照して「sender が当該ルームに join 済みか」を確認する。
// （例: 鍵付きルームに join せずに play / passcode_changed を撃ち込まれるのを防ぐ）
type Session = { roomSlug: string };

const participantsByRoom = new Map<string, Map<string, Participant>>();

function getParticipants(roomSlug: string) {
  let map = participantsByRoom.get(roomSlug);
  if (!map) {
    map = new Map();
    participantsByRoom.set(roomSlug, map);
  }
  return map;
}

// 参加者が 0 人になった瞬間 / 再び入室した瞬間に Room.lastOccupiedAt を「今」に更新する。
// クリーンアップは「lastOccupiedAt が TTL を超えて古い」ルームだけを対象にするので、
// ここで touch し忘れると生きているルームまで削除される。
// DB 失敗でアプリを落としたくないので catch して黙殺（次回の join/leave/sweep で自己回復する）。
async function touchRoomOccupancy(roomSlug: string) {
  try {
    await prisma.room.update({
      where: { slug: roomSlug },
      data: { lastOccupiedAt: new Date() },
    });
  } catch {
    // ルームが既に削除されている等は無視
  }
}

// テスト用: 参加者マップを外部から掃除できるようにする（プロセス内 Map なのでテスト間で漏れる）
export function __resetParticipantsForTest() {
  participantsByRoom.clear();
}

// クリーンアップ側から「今この瞬間、誰かいるルーム」の slug 一覧を取得するための出口。
// sweep のたびにこれらのルームの lastOccupiedAt を「今」に更新しておくことで、
// 長時間稼働中のルームが TTL 到達で消されるのを防ぐ（server プロセス再起動時のみ一旦リセット）。
export function getOccupiedRoomSlugs(): string[] {
  const out: string[] = [];
  for (const [slug, map] of participantsByRoom) {
    if (map.size > 0) out.push(slug);
  }
  return out;
}

// sender が `roomSlug` に join しているかを確認するガード。
// 未 join の場合は error イベントだけ返してそれ以上は何もしない（DoS にならないよう静かに弾く）。
function ensureJoined(socket: Socket, roomSlug: string, session: Session | null): boolean {
  if (!session || session.roomSlug !== roomSlug) {
    socket.emit("error", { message: "Not joined" });
    return false;
  }
  return true;
}

export function registerSocketHandlers(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    let session: Session | null = null;

    socket.on("join_room", async ({ roomSlug, userName }: JoinPayload) => {
      const room = await prisma.room.findUnique({ where: { slug: roomSlug } });
      if (!room) {
        socket.emit("error", { message: "Room not found" });
        return;
      }
      // 鍵付きルームは handshake Cookie の passcode が一致した socket のみ参加可能。
      // REST の SSR ゲートと同じ Cookie を参照するため、ブラウザからは自動的に付く。
      if (room.passcode) {
        const cookieHeader = socket.handshake.headers.cookie;
        if (!verifyPasscodeFromCookieHeader(roomSlug, cookieHeader, room.passcode)) {
          socket.emit("error", { message: "Unauthorized" });
          return;
        }
      }
      session = { roomSlug };
      await socket.join(roomSlug);
      const participants = getParticipants(roomSlug);
      participants.set(socket.id, { socketId: socket.id, name: userName || "guest" });
      io.to(roomSlug).emit("participants", Array.from(participants.values()));
      // 参加のたびに lastOccupiedAt をリセット。空室 TTL のカウントをここで 0 に戻す。
      await touchRoomOccupancy(roomSlug);
    });

    socket.on("leave_room", async ({ roomSlug }: { roomSlug: string }) => {
      // 自分が join しているルーム以外の leave 要求は無視。
      if (!session || session.roomSlug !== roomSlug) return;
      await socket.leave(roomSlug);
      const participants = getParticipants(roomSlug);
      participants.delete(socket.id);
      io.to(roomSlug).emit("participants", Array.from(participants.values()));
      session = null;
      // 退出で 0 人になった場合、その「最後の瞬間」を lastOccupiedAt に記録する。
      // ここから TTL 日数経過で削除対象になる。
      if (participants.size === 0) {
        await touchRoomOccupancy(roomSlug);
      }
    });

    socket.on("track_added", ({ roomSlug, trackId }: AddTrackPayload) => {
      if (!ensureJoined(socket, roomSlug, session)) return;
      socket.to(roomSlug).emit("track_added", { trackId });
    });

    socket.on("queue_changed", ({ roomSlug }: { roomSlug: string }) => {
      if (!ensureJoined(socket, roomSlug, session)) return;
      socket.to(roomSlug).emit("queue_changed", {});
    });

    socket.on("play", ({ roomSlug, trackId, positionSec }: PlaybackPayload) => {
      if (!ensureJoined(socket, roomSlug, session)) return;
      socket.to(roomSlug).emit("play", { trackId, positionSec: positionSec ?? 0 });
    });

    socket.on("pause", ({ roomSlug }: PlaybackPayload) => {
      if (!ensureJoined(socket, roomSlug, session)) return;
      socket.to(roomSlug).emit("pause", {});
    });

    socket.on("skip", ({ roomSlug }: PlaybackPayload) => {
      if (!ensureJoined(socket, roomSlug, session)) return;
      socket.to(roomSlug).emit("skip", {});
    });

    socket.on(
      "settings_changed",
      ({
        roomSlug,
        loopPlayback,
        shufflePlayback,
      }: {
        roomSlug: string;
        loopPlayback?: boolean;
        shufflePlayback?: boolean;
      }) => {
        if (!ensureJoined(socket, roomSlug, session)) return;
        socket.to(roomSlug).emit("settings_changed", { loopPlayback, shufflePlayback });
      },
    );

    // パスコード変更通知。クライアントから渡された値は信用せず、サーバが DB を読んで現値を中継する。
    // こうしないと第三者が `{ passcode: null }` を撃ち込むだけで全メンバーの Cookie が解除され、
    // 鍵付きルームから締め出される事故が起きる。
    socket.on("passcode_changed", async ({ roomSlug }: { roomSlug: string }) => {
      if (!ensureJoined(socket, roomSlug, session)) return;
      try {
        const room = await prisma.room.findUnique({
          where: { slug: roomSlug },
          select: { passcode: true },
        });
        if (!room) return;
        socket.to(roomSlug).emit("passcode_changed", { passcode: room.passcode });
      } catch {
        // DB 失敗はアプリを落としたくないので無視。次回の操作で自己回復する。
      }
    });

    // A new listener asks the room "what's playing and where?". Every
    // currently-listening peer that receives the query may reply; the
    // requester adopts whichever reply arrives first (race-based, good
    // enough for the "rough position" UX we target).
    socket.on("state_query", ({ roomSlug }: { roomSlug: string }) => {
      if (!ensureJoined(socket, roomSlug, session)) return;
      socket.to(roomSlug).emit("state_query", { requesterSocketId: socket.id });
    });

    socket.on(
      "state_reply",
      ({
        requesterSocketId,
        trackId,
        positionSec,
      }: {
        requesterSocketId: string;
        trackId: string;
        positionSec: number;
      }) => {
        // state_reply は join 済みのソケットからのみ受け付ける。
        // requester は別ソケットなので roomSlug ベースのチェックは効かないが、
        // 「自分がどこかのルームに join している」程度の最低限のガードはかける。
        if (!session) {
          socket.emit("error", { message: "Not joined" });
          return;
        }
        io.to(requesterSocketId).emit("state_reply", { trackId, positionSec });
      },
    );

    socket.on("disconnect", () => {
      if (session) {
        const roomSlug = session.roomSlug;
        const participants = getParticipants(roomSlug);
        participants.delete(socket.id);
        io.to(roomSlug).emit("participants", Array.from(participants.values()));
        if (participants.size === 0) {
          void touchRoomOccupancy(roomSlug);
        }
        session = null;
      }
    });
  });
}
