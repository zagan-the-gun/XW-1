import { z } from "zod";

// 紛らわしい文字 (0/O, 1/I/L) を除外した大文字英数字セット。slug と同じ方針。
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const PASSCODE_LENGTH = 6;

export function generateRoomPasscode(length = PASSCODE_LENGTH) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export const RoomPasscodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{6}$/, "パスコードは6桁の大文字英数字です");

export function isValidPasscode(value: unknown): value is string {
  return RoomPasscodeSchema.safeParse(value).success;
}
