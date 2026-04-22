// Route Handler を直接呼び出すためのリクエスト組み立てユーティリティ。

export function jsonRequest(
  url: string,
  init: { method?: string; body?: unknown; cookies?: Record<string, string> } = {},
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.cookies) {
    const cookieHeader = Object.entries(init.cookies)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("; ");
    headers.set("cookie", cookieHeader);
  }
  return new Request(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

export function paramsOf<T extends Record<string, string>>(p: T) {
  return { params: Promise.resolve(p) };
}

export async function readJson<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export function setCookiesOf(res: Response): string[] {
  // Node 20+ の標準 API。複数 Set-Cookie を分解して返す。
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const raw = res.headers.get("set-cookie");
  return raw ? [raw] : [];
}

export function findSetCookie(res: Response, name: string): string | undefined {
  return setCookiesOf(res).find((c) => c.startsWith(`${name}=`));
}
