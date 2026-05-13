import { afterEach, describe, expect, it, vi } from "vitest";
import { generateRoomSlug } from "@/lib/slug";

describe("generateRoomSlug", () => {
  it("デフォルトで 8 文字、引数指定で任意長を生成する", () => {
    expect(generateRoomSlug()).toHaveLength(8);
    expect(generateRoomSlug(12)).toHaveLength(12);
  });

  it("常に小文字英数字のみで生成される", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateRoomSlug()).toMatch(/^[a-z2-9]{8}$/);
    }
  });

  it("ALPHABET から除外された文字 (0, 1, l) を含まない", () => {
    // slug は小文字英数字のうち 0/1/l を除外する仕様（passcode と除外文字の構成は異なる）。
    const banned = new Set(["0", "1", "l"]);
    for (let i = 0; i < 500; i++) {
      const slug = generateRoomSlug();
      for (const ch of slug) {
        expect(banned.has(ch)).toBe(false);
      }
    }
  });

  it("十分な多様性を持つ（100 回試行で過度な重複がない）", () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(generateRoomSlug());
    // 33^8 ≈ 1.4 兆通り。100 件で 99 件以上ユニークが正常。
    expect(set.size).toBeGreaterThan(95);
  });

  describe("CSPRNG 使用の保証", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("Math.random を呼ばない（予測可能な PRNG への退行を防ぐ）", () => {
      const spy = vi.spyOn(Math, "random");
      for (let i = 0; i < 50; i++) generateRoomSlug();
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
