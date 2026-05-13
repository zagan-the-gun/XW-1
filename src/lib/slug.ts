import { randomInt } from "node:crypto";

const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

// CSPRNG (`crypto.randomInt`) を使う理由は `passcode.ts` と同じ（過去出力からの予測攻撃を防ぐ）。
// slug は鍵そのものではないが、「他人が直近作ったルームの URL を当てて先回りする」攻撃面になるため
// passcode と同等に扱う。
export function generateRoomSlug(length = 8) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return out;
}
