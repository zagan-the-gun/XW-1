import type { APIRequestContext } from "@playwright/test";

export async function createRoomViaApi(
  request: APIRequestContext,
  opts: { name: string; withPasscode?: boolean } = { name: "E2E Room" },
): Promise<{ slug: string; passcode: string | null }> {
  const res = await request.post("/api/rooms", {
    data: {
      name: opts.name,
      withPasscode: Boolean(opts.withPasscode),
    },
  });
  if (!res.ok()) {
    throw new Error(`createRoomViaApi failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    room: { slug: string };
    passcode: string | null;
  };
  return { slug: body.room.slug, passcode: body.passcode };
}

export async function deleteRoomViaApi(
  request: APIRequestContext,
  slug: string,
  passcode?: string | null,
): Promise<void> {
  await request.delete(`/api/rooms/${slug}`, {
    headers: passcode ? { cookie: `xw_passcode_${slug}=${passcode}` } : undefined,
  });
}
