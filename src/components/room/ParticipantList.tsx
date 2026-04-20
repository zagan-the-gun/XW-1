"use client";

import { User } from "lucide-react";

export type Participant = {
  socketId: string;
  name: string;
};

export function ParticipantList({
  participants,
  me,
}: {
  participants: Participant[];
  me: string;
}) {
  if (participants.length === 0) {
    return <p className="text-sm text-muted-foreground">あなただけです</p>;
  }
  return (
    <ul className="space-y-1.5">
      {participants.map((p) => (
        <li
          key={p.socketId}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 bg-black/20"
        >
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm truncate">
            {p.name}
            {p.name === me && (
              <span className="ml-2 text-xs text-primary">(あなた)</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
