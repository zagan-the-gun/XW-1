import { vi } from "vitest";

// next/headers の cookies() を差し替えるための可変ストア。
// Route Handler 内で `const store = await cookies(); store.get(name)` を呼ぶ箇所に反映される。
const mockCookieStore: { value: Record<string, string> } = { value: {} };

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const v = mockCookieStore.value[name];
      return v !== undefined ? { name, value: v } : undefined;
    },
  })),
}));

export function setMockCookies(cookies: Record<string, string>) {
  mockCookieStore.value = { ...cookies };
}

export function clearMockCookies() {
  mockCookieStore.value = {};
}
