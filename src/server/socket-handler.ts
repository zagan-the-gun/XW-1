import type { Server as SocketIOServer, Socket } from "socket.io";
import { prisma } from "@/lib/prisma";
import { verifyPasscodeFromCookieHeader } from "@/lib/room-auth";

type JoinPayload = { roomSlug: string; userName: string };
type AddTrackPayload = { roomSlug: string; trackId: string };
type PlaybackPayload = { roomSlug: string; trackId?: string; positionSec?: number };
type PasscodeChangedPayload = { roomSlug: string; passcode: string | null };

type Participant = { socketId: string; name: string };

const participantsByRoom = new Map<string, Map<string, Participant>>();

function getParticipants(roomSlug: string) {
  let map = participantsByRoom.get(roomSlug);
  if (!map) {
    map = new Map();
    participantsByRoom.set(roomSlug, map);
  }
  return map;
}

export function registerSocketHandlers(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    let currentRoom: string | null = null;

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
      currentRoom = roomSlug;
      await socket.join(roomSlug);
      const participants = getParticipants(roomSlug);
      participants.set(socket.id, { socketId: socket.id, name: userName || "guest" });
      io.to(roomSlug).emit("participants", Array.from(participants.values()));
    });

    socket.on("leave_room", async ({ roomSlug }: { roomSlug: string }) => {
      await socket.leave(roomSlug);
      const participants = getParticipants(roomSlug);
      participants.delete(socket.id);
      io.to(roomSlug).emit("participants", Array.from(participants.values()));
      currentRoom = null;
    });

    socket.on("track_added", ({ roomSlug, trackId }: AddTrackPayload) => {
      socket.to(roomSlug).emit("track_added", { trackId });
    });

    socket.on("queue_changed", ({ roomSlug }: { roomSlug: string }) => {
      socket.to(roomSlug).emit("queue_changed", {});
    });

    socket.on("play", ({ roomSlug, trackId, positionSec }: PlaybackPayload) => {
      socket.to(roomSlug).emit("play", { trackId, positionSec: positionSec ?? 0 });
    });

    socket.on("pause", ({ roomSlug }: PlaybackPayload) => {
      socket.to(roomSlug).emit("pause", {});
    });

    socket.on("skip", ({ roomSlug }: PlaybackPayload) => {
      socket.to(roomSlug).emit("skip", {});
    });

    socket.on(
      "settings_changed",
      ({ roomSlug, loopPlayback }: { roomSlug: string; loopPlayback?: boolean }) => {
        socket.to(roomSlug).emit("settings_changed", { loopPlayback });
      },
    );

    // パスコード変更通知。DB 更新は REST PATCH 側で完了済みで、これは単なる中継。
    // 受信側クライアントは /auth に新パスコードを送って自分の Cookie を張り替える。
    socket.on("passcode_changed", ({ roomSlug, passcode }: PasscodeChangedPayload) => {
      socket.to(roomSlug).emit("passcode_changed", { passcode });
    });

    // A new listener asks the room "what's playing and where?". Every
    // currently-listening peer that receives the query may reply; the
    // requester adopts whichever reply arrives first (race-based, good
    // enough for the "rough position" UX we target).
    socket.on("state_query", ({ roomSlug }: { roomSlug: string }) => {
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
        io.to(requesterSocketId).emit("state_reply", { trackId, positionSec });
      },
    );

    socket.on("disconnect", () => {
      if (currentRoom) {
        const participants = getParticipants(currentRoom);
        participants.delete(socket.id);
        io.to(currentRoom).emit("participants", Array.from(participants.values()));
      }
    });
  });
}
