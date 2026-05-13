import { afterEach, describe, expect, it } from "vitest";
import { isSameOriginRequest } from "@/lib/room-auth-server";

function makeRequest(
  url: string,
  init: { method?: string; origin?: string; referer?: string; host?: string } = {},
): Request {
  const u = new URL(url);
  const headers = new Headers();
  if (init.origin) headers.set("origin", init.origin);
  if (init.referer) headers.set("referer", init.referer);
  // Web Standard で host ヘッダは書けないため、URL の host を req.url から取らせる。
  return new Request(`${u.protocol}//${init.host ?? u.host}${u.pathname}${u.search}`, {
    method: init.method ?? "POST",
    headers,
  });
}

const ORIGINAL_ALLOWED = process.env.ALLOWED_ORIGINS;

afterEach(() => {
  if (ORIGINAL_ALLOWED === undefined) {
    delete process.env.ALLOWED_ORIGINS;
  } else {
    process.env.ALLOWED_ORIGINS = ORIGINAL_ALLOWED;
  }
});

describe("isSameOriginRequest", () => {
  it("GET / HEAD / OPTIONS は常に true（state を変えないため）", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(isSameOriginRequest(makeRequest("http://app.test/api/x", { method }))).toBe(true);
    }
  });

  it("Origin ヘッダが Host と一致すれば true", () => {
    const req = makeRequest("http://app.test/api/x", { origin: "http://app.test" });
    expect(isSameOriginRequest(req)).toBe(true);
  });

  it("Origin が外部だと false", () => {
    const req = makeRequest("http://app.test/api/x", { origin: "https://evil.example" });
    expect(isSameOriginRequest(req)).toBe(false);
  });

  it("Origin 無しでも Referer が Host と一致なら true", () => {
    const req = makeRequest("http://app.test/api/x", { referer: "http://app.test/some/page" });
    expect(isSameOriginRequest(req)).toBe(true);
  });

  it("Origin / Referer 両方とも無いと false（保守的に拒否）", () => {
    const req = makeRequest("http://app.test/api/x");
    expect(isSameOriginRequest(req)).toBe(false);
  });

  it("Origin と Referer のどちらか一つでも不一致なら false（混在攻撃を防ぐ）", () => {
    const req = makeRequest("http://app.test/api/x", {
      origin: "http://app.test",
      referer: "https://evil.example/",
    });
    expect(isSameOriginRequest(req)).toBe(false);
  });

  it("ALLOWED_ORIGINS に列挙されたオリジンは Host と違っても通す", () => {
    process.env.ALLOWED_ORIGINS = "https://app.example.com, https://staging.example.com";
    const req = makeRequest("http://internal.lb/api/x", {
      origin: "https://app.example.com",
    });
    expect(isSameOriginRequest(req)).toBe(true);
  });

  it("ALLOWED_ORIGINS に無くてもリクエスト Host 自身は通す（http/https 両方）", () => {
    process.env.ALLOWED_ORIGINS = "https://other.example.com";
    expect(
      isSameOriginRequest(
        makeRequest("http://localhost:3000/api/x", { origin: "http://localhost:3000" }),
      ),
    ).toBe(true);
    expect(
      isSameOriginRequest(
        makeRequest("https://app.test/api/x", { origin: "https://app.test" }),
      ),
    ).toBe(true);
  });
});
