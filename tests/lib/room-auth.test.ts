import { describe, expect, it } from "vitest";
import {
  buildClearPasscodeCookie,
  buildSetPasscodeCookie,
  parseCookieHeader,
  passcodeCookieName,
  verifyPasscodeFromCookieHeader,
} from "@/lib/room-auth";

describe("passcodeCookieName", () => {
  it("slug を含むキー名を返す", () => {
    expect(passcodeCookieName("abc123")).toBe("xw_passcode_abc123");
  });
});

describe("parseCookieHeader", () => {
  it("空/undefined/null は空オブジェクトを返す", () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader(null)).toEqual({});
    expect(parseCookieHeader("")).toEqual({});
  });

  it("単一の key=value をパースする", () => {
    expect(parseCookieHeader("foo=bar")).toEqual({ foo: "bar" });
  });

  it("複数の key=value; をパースする", () => {
    expect(parseCookieHeader("a=1; b=2; c=3")).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("前後の空白をトリムする", () => {
    expect(parseCookieHeader("  foo =  bar ")).toEqual({ foo: "bar" });
  });

  it("URL エンコードされた値をデコードする", () => {
    expect(parseCookieHeader("token=hello%20world")).toEqual({ token: "hello world" });
  });

  it("= を含む value を正しく扱う（base64 など）", () => {
    expect(parseCookieHeader("sess=abc=def==")).toEqual({ sess: "abc=def==" });
  });

  it("key の無いエントリを無視する", () => {
    expect(parseCookieHeader("=orphan; good=1")).toEqual({ good: "1" });
  });
});

describe("verifyPasscodeFromCookieHeader", () => {
  const slug = "abc123";

  it("鍵なしルーム (roomPasscode=null) は常に true", () => {
    expect(verifyPasscodeFromCookieHeader(slug, null, null)).toBe(true);
    expect(verifyPasscodeFromCookieHeader(slug, "", null)).toBe(true);
    expect(verifyPasscodeFromCookieHeader(slug, undefined, null)).toBe(true);
  });

  it("鍵ありルームで Cookie 一致なら true", () => {
    expect(
      verifyPasscodeFromCookieHeader(slug, `xw_passcode_${slug}=A1B2C3`, "A1B2C3"),
    ).toBe(true);
  });

  it("鍵ありルームで Cookie 不一致なら false", () => {
    expect(
      verifyPasscodeFromCookieHeader(slug, `xw_passcode_${slug}=X9Y8Z7`, "A1B2C3"),
    ).toBe(false);
  });

  it("鍵ありルームで Cookie 欠落なら false", () => {
    expect(verifyPasscodeFromCookieHeader(slug, "", "A1B2C3")).toBe(false);
    expect(verifyPasscodeFromCookieHeader(slug, undefined, "A1B2C3")).toBe(false);
    expect(verifyPasscodeFromCookieHeader(slug, "other=1", "A1B2C3")).toBe(false);
  });

  it("別ルームの Cookie が混ざっていても対象 slug だけを見る", () => {
    const header = `xw_passcode_other=wrong; xw_passcode_${slug}=A1B2C3`;
    expect(verifyPasscodeFromCookieHeader(slug, header, "A1B2C3")).toBe(true);
  });
});

describe("buildSetPasscodeCookie / buildClearPasscodeCookie", () => {
  it("Set-Cookie 属性を組み立てる", () => {
    const out = buildSetPasscodeCookie("abc123", "A1B2C3");
    expect(out).toContain("xw_passcode_abc123=A1B2C3");
    expect(out).toContain("HttpOnly");
    expect(out).toContain("SameSite=Lax");
    expect(out).toContain("Path=/");
    expect(out).toMatch(/Max-Age=\d+/);
  });

  it("clear は Max-Age=0 を含む", () => {
    const out = buildClearPasscodeCookie("abc123");
    expect(out).toContain("xw_passcode_abc123=");
    expect(out).toContain("Max-Age=0");
  });
});
