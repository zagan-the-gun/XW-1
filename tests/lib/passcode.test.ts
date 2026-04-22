import { describe, expect, it } from "vitest";
import {
  PASSCODE_LENGTH,
  RoomPasscodeSchema,
  generateRoomPasscode,
  isValidPasscode,
} from "@/lib/passcode";

describe("generateRoomPasscode", () => {
  it("指定の長さで生成する", () => {
    expect(generateRoomPasscode()).toHaveLength(PASSCODE_LENGTH);
    expect(generateRoomPasscode(10)).toHaveLength(10);
  });

  it("常に大文字英数字のみで生成される", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateRoomPasscode()).toMatch(/^[A-Z0-9]{6}$/);
    }
  });

  it("紛らわしい文字 (0, O, 1, I, L) を含まない", () => {
    const banned = new Set(["0", "O", "1", "I", "L"]);
    for (let i = 0; i < 500; i++) {
      const code = generateRoomPasscode();
      for (const ch of code) {
        expect(banned.has(ch)).toBe(false);
      }
    }
  });

  it("十分な多様性を持つ（100 回試行で過度な重複がない）", () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(generateRoomPasscode());
    // 衝突率 50% を超えるのは生成ロジックの欠陥（ALPHABET^6 = 30^6 ≈ 7億通り）。
    expect(set.size).toBeGreaterThan(95);
  });
});

describe("RoomPasscodeSchema", () => {
  it("6桁の大文字英数字を受け入れる", () => {
    expect(RoomPasscodeSchema.safeParse("A1B2C3").success).toBe(true);
    expect(RoomPasscodeSchema.safeParse("ZZZZZZ").success).toBe(true);
    expect(RoomPasscodeSchema.safeParse("999999").success).toBe(true);
  });

  it("長さが違う/小文字/記号は拒否する", () => {
    expect(RoomPasscodeSchema.safeParse("A1B2C").success).toBe(false);
    expect(RoomPasscodeSchema.safeParse("A1B2C3D").success).toBe(false);
    expect(RoomPasscodeSchema.safeParse("abc123").success).toBe(false);
    expect(RoomPasscodeSchema.safeParse("A1B2C!").success).toBe(false);
    expect(RoomPasscodeSchema.safeParse("").success).toBe(false);
  });
});

describe("isValidPasscode", () => {
  it("型ガードとして機能する", () => {
    const value: unknown = "A1B2C3";
    expect(isValidPasscode(value)).toBe(true);
    expect(isValidPasscode("abc")).toBe(false);
    expect(isValidPasscode(null)).toBe(false);
    expect(isValidPasscode(123456)).toBe(false);
  });
});
