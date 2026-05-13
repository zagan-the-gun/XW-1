import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// CSRF テストでは Cookie の有無は本筋ではないが、auth helper が cookies() を呼ぶので
// next/headers をモックしておく（other tests と同じ形）。
import { clearMockCookies } from "../helpers/next-cookies-mock";

import { POST as createRoom } from "@/app/api/rooms/route";
import { POST as authPost } from "@/app/api/rooms/[slug]/auth/route";
import { POST as addTrack } from "@/app/api/rooms/[slug]/tracks/route";
import { resetDatabase } from "../helpers/db";
import { jsonRequest, paramsOf } from "../helpers/requests";

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  clearMockCookies();
});

describe("CSRF (Origin / Referer) 検証", () => {
  it("POST /api/rooms: Origin も Referer も無いと 403", async () => {
    const res = await createRoom(
      jsonRequest("http://localhost/api/rooms", {
        method: "POST",
        body: { name: "no-origin" },
        origin: null,
        referer: null,
      }),
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/rooms: Origin が外部ドメインだと 403", async () => {
    const res = await createRoom(
      jsonRequest("http://localhost/api/rooms", {
        method: "POST",
        body: { name: "evil" },
        origin: "https://evil.example",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/rooms: Origin 無しでも Referer が同一オリジンなら通る", async () => {
    const res = await createRoom(
      jsonRequest("http://localhost/api/rooms", {
        method: "POST",
        body: { name: "via-referer" },
        origin: null,
        referer: "http://localhost/",
      }),
    );
    expect(res.status).toBe(201);
  });

  it("POST /api/rooms/[slug]/auth: 別ドメインからの POST は 403", async () => {
    const res = await authPost(
      jsonRequest("http://localhost/api/rooms/x/auth", {
        method: "POST",
        body: { passcode: "A1B2C3" },
        origin: "https://evil.example",
      }),
      paramsOf({ slug: "x" }),
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/rooms/[slug]/tracks: 別ドメインからの POST は 403（DB アクセスより前に弾く）", async () => {
    const res = await addTrack(
      jsonRequest("http://localhost/api/rooms/anywhere/tracks", {
        method: "POST",
        body: { url: "https://www.youtube.com/watch?v=AAA" },
        origin: "https://evil.example",
      }),
      paramsOf({ slug: "anywhere" }),
    );
    expect(res.status).toBe(403);
  });

  it("ALLOWED_ORIGINS に列挙されたオリジンは通る", async () => {
    const original = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = "https://app.example.com,https://staging.example.com";
    try {
      const res = await createRoom(
        jsonRequest("http://localhost/api/rooms", {
          method: "POST",
          body: { name: "allowed" },
          origin: "https://app.example.com",
        }),
      );
      expect(res.status).toBe(201);
    } finally {
      if (original === undefined) {
        delete process.env.ALLOWED_ORIGINS;
      } else {
        process.env.ALLOWED_ORIGINS = original;
      }
    }
  });
});
