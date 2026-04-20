import type { Server as SocketIOServer, Socket } from "socket.io";
import { prisma } from "@/lib/prisma";

type JoinPayload = { roomSlug: string; userName: string };
type AddTrackPayload = { roomSlug: string; trackId: string };
type PlaybackPayload = { roomSlug: string; trackId?: string; positionSec?: number };

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

    socket.on("sync_state", ({ roomSlug, trackId, positionSec }: PlaybackPayload) => {
      socket.to(roomSlug).emit("sync_state", { trackId, positionSec: positionSec ?? 0 });
    });

    socket.on(
      "settings_changed",
      ({ roomSlug, loopPlayback }: { roomSlug: string; loopPlayback?: boolean }) => {
        socket.to(roomSlug).emit("settings_changed", { loopPlayback });
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
