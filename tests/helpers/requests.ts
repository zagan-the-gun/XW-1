// Route Handler を直接呼び出すためのリクエスト組み立てユーティリティ。

export function jsonRequest(
  url: string,
  init: {
    method?: string;
    body?: unknown;
    cookies?: Record<string, string>;
    // CSRF 検証テスト用: 明示的に null を渡せば Origin/Referer ヘッダを付けない。
    // 未指定 (undefined) の場合は url のオリジンと同じ値を付与し、通常の同一オリジン要求として扱う。
    origin?: string | null;
    referer?: string | null;
    // レートリミットテスト用の `x-forwarded-for` ヘッダ。指定しない限り未設定（= IP 不明扱い）。
    ip?: string;
  } = {},
): Request {
  const u = new URL(url);
  // host は Web Standard の Forbidden header で Headers から設定できないため、
  // CSRF 判定側は req.url から URL().host で取り出すフォールバックを使う。
  const headers = new Headers({ "content-type": "application/json" });
  const defaultOrigin = `${u.protocol}//${u.host}`;
  if (init.origin === null) {
    // 明示的に省略
  } else {
    headers.set("origin", init.origin ?? defaultOrigin);
  }
  if (init.referer === null) {
    // 明示的に省略
  } else if (init.referer !== undefined) {
    headers.set("referer", init.referer);
  }
  if (init.cookies) {
    const cookieHeader = Object.entries(init.cookies)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("; ");
    headers.set("cookie", cookieHeader);
  }
  if (init.ip) {
    headers.set("x-forwarded-for", init.ip);
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
