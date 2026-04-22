import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { Server as SocketIOServer } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { registerSocketHandlers } from "@/server/socket-handler";

export type TestSocketHarness = {
  url: string;
  ioServer: SocketIOServer;
  httpServer: HttpServer;
  makeClient: (opts?: { cookie?: string }) => ClientSocket;
  close: () => Promise<void>;
};

export async function startTestSocketServer(): Promise<TestSocketHarness> {
  const httpServer = createServer();
  // bind を先に済ませてから Socket.io を attach する。順序を逆にすると engine.io の
  // アップグレードリスナーが未バインドな状態で登録され、初回 client 接続が到達しないことがある。
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });

  const ioServer = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
  });
  registerSocketHandlers(ioServer);

  const { port } = httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;

  const clients: ClientSocket[] = [];

  const makeClient: TestSocketHarness["makeClient"] = (opts = {}) => {
    const client = ioClient(url, {
      transports: ["websocket"],
      forceNew: true,
      extraHeaders: opts.cookie ? { cookie: opts.cookie } : undefined,
    });
    clients.push(client);
    return client;
  };

  const close = async () => {
    for (const c of clients) c.disconnect();
    clients.length = 0;
    await new Promise<void>((resolve) => {
      ioServer.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  };

  return { url, ioServer, httpServer, makeClient, close };
}

export function disconnectAllClients(harness: TestSocketHarness): Promise<void> {
  // `harness.close()` せずに、各テスト後に作ったクライアントだけ掃除したいときに使う。
  // harness 内の clients 配列にアクセスする必要があるので、`close` と同じ実装を別 export で用意。
  return new Promise<void>((resolve) => {
    const ioServer = harness.ioServer;
    // disconnectSockets でサーバ側から切断し、全員の disconnect ハンドラを走らせる。
    // これで participantsByRoom の残留も防げる。
    ioServer.disconnectSockets(true);
    setTimeout(() => resolve(), 50);
  });
}

export function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 2000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timeout waiting for ${event} (${timeoutMs}ms)`));
    }, timeoutMs);
    const onEvent = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, onEvent);
  });
}

export function waitForNoEvent(socket: ClientSocket, event: string, waitMs = 300): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEvent = () => {
      clearTimeout(timer);
      socket.off(event, onEvent);
      reject(new Error(`unexpected ${event} event received`));
    };
    socket.once(event, onEvent);
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve();
    }, waitMs);
  });
}
