import { randomInt } from "node:crypto";
import { z } from "zod";

// 紛らわしい文字 (0/O, 1/I/L) を除外した大文字英数字セット。slug と同じ方針。
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const PASSCODE_LENGTH = 6;

// CSPRNG (`crypto.randomInt`) を使う。`Math.random()` だと V8 の xorshift128+ の
// 内部状態を出力数個から逆算でき、過去/未来の生成値が予測される（passcode 漏洩 → 別ルーム侵入）。
// `randomInt(min, max)` は範囲外を捨てて再抽選するため modulo bias も無い。
export function generateRoomPasscode(length = PASSCODE_LENGTH) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return out;
}

export const RoomPasscodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{6}$/, "パスコードは6桁の大文字英数字です");

export function isValidPasscode(value: unknown): value is string {
  return RoomPasscodeSchema.safeParse(value).success;
}
