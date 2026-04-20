const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

export function generateRoomSlug(length = 8) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}
