# Backend

> Next.js カスタムサーバー（`server.ts`）配下の REST API / Prisma / Socket.io の実装ガイド。
> 全体像は [architecture.md](./architecture.md) を参照。

## 1. ランタイム構成

```
tsx server.ts
  └─ createServer (Node http)
      ├─ Next.js app.getRequestHandler()   ← ページ / API Routes
      └─ Socket.io (path: /api/socketio)    ← リアルタイム
```

- `server.ts` は Next.js カスタムサーバー。`http.createServer` 1つに **HTTP ハンドラ**と **Socket.io** を同居させている
- ポート / ホストは環境変数で上書き可能（`HOST`, `PORT`）。デフォルトは `0.0.0.0:3000`
- **`HOSTNAME` は使わない**（理由: [infrastructure.md §5.5](./infrastructure.md#55-hostname-環境変数の罠)）

## 2. Prisma スキーマ

正本は `prisma/schema.prisma`。主要モデル：

### Room

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | `cuid` | 主キー |
| `slug` | `string` unique | URL に使う短いID（`generateRoomSlug()` で 8 文字、誤認しにくいアルファベット） |
| `loopPlayback` | `boolean` | キュー末尾到達後にリセットして繰り返すか |
| `isPublic` | `boolean` | 公開フラグ（現状 UI からはトグル不可。一覧 API で見せるか等の判断に使う想定） |
| `hostId` | `string?` | 将来の認証用（現状未使用） |
| `passcode` | `string?` | オンラインゲームのロビー風のパスコード。`null`=鍵なし、6桁の大文字英数字（`0/O/1/I/L` 除外）。**平文保存**（ルーム内メンバーが閲覧可能であること自体が要件のため）|
| `lastOccupiedAt` | `datetime` | 参加者が最後に居た（または現在居る）時刻。空室 TTL クリーンアップの基準。Socket ハンドラの `join_room` / `leave_room` / `disconnect`（参加者 0 人化時）と、`room-cleanup` の sweep で更新する |

> 「同期再生するか」はルーム設定ではなく **per-user / per-device の localStorage 設定**。詳細は [frontend.md §3](./frontend.md#3-roomclient-の状態管理) を参照。

### Track

| フィールド | 型 | 説明 |
|---|---|---|
| `roomId` | FK | `Room` に所属 |
| `url` / `platform` / `externalId` | | 正規化済みURL・プラットフォーム・ID |
| `title` / `thumbnail` / `durationSec` | | メタデータ（oEmbed / getthumbinfo から） |
| `position` | `int` | キュー順序。挿入時は後続を `+1` |
| `status` | `QUEUED \| PLAYING \| PLAYED \| SKIPPED` | 再生状態 |

### Enum 一覧

```
Platform      = YOUTUBE | SOUNDCLOUD | NICONICO | VIMEO | WISTIA
TrackStatus   = QUEUED | PLAYING | PLAYED | SKIPPED
```

`TrackStatus.PLAYING` は現在の実装では実際にセットされる経路がない（`QUEUED → PLAYED/SKIPPED` のみ運用）。enum 値だけ残しているのは将来サーバ側で「今再生中の曲」を持たせる余地のため。

### インデックス

- `Room(slug)` unique
- `Room(lastOccupiedAt)` — クリーンアップ sweep の範囲スキャン用
- `Track(roomId, position)` — キュー走査用
- `Track(roomId, status)` — 状態フィルタ用

### マイグレーション運用

```bash
docker compose exec app npx prisma migrate dev --name <意図を示す短い名前>
```

- 開発中は `migrate dev`、本番は `migrate deploy`
- `prisma/migrations/` のディレクトリ名はタイムスタンプ付き。コミットして管理
- スキーマ変更時は [architecture.md §3](./architecture.md#3-データモデル概要) の ER 図 / このドキュメントの表も更新すること

## 3. REST API

エンドポイント一覧。状態を変更する正本はすべてここ（Socket.io は通知のみ）。

### Rooms

| Method | Path | 役割 | 備考 |
|---|---|---|---|
| `GET` | `/api/rooms` | ルーム一覧（updatedAt 降順、50件） | レスポンスの各 room に `hasPasscode: boolean` が付く。`passcode` 自体は含まれない |
| `POST` | `/api/rooms` | ルーム作成 | `name`, `isPublic`（任意）, `withPasscode`（任意）, `passcode`（任意、6桁英数字）。`passcode` 明示時はその値で保存（フォームが事前生成した値をそのまま使うため）。未指定かつ `withPasscode=true` ならサーバ側で自動生成。いずれの場合も成功レスポンス body と Set-Cookie で passcode を返す |
| `GET` | `/api/rooms/[slug]` | 単一ルーム取得（tracks 込み） | 鍵ありルームは Cookie `xw_passcode_<slug>` が一致した場合のみ 200。不一致/欠落は `401` |
| `PATCH` | `/api/rooms/[slug]` | ルーム設定更新 | `loopPlayback`, `name`, `passcode` の部分更新。`passcode: "regenerate"` で生成/再生成、`passcode: null` で解除。鍵ありルームの操作は Cookie 必須、鍵なし→鍵ありの「初回設定」だけは誰でも可 |
| `DELETE` | `/api/rooms/[slug]` | ルーム削除 | `onDelete: Cascade` でトラックも削除。鍵あり時は Cookie 必須 |
| `POST` | `/api/rooms/[slug]/auth` | パスコード認証 | body `{ passcode }` を検証、一致で `xw_passcode_<slug>` Cookie を Set（HttpOnly / SameSite=Lax / Max-Age=30d） |
| `DELETE` | `/api/rooms/[slug]/auth` | パスコード Cookie クリア | Max-Age=0 の Set-Cookie を返す |

### Tracks

| Method | Path | 役割 | 備考 |
|---|---|---|---|
| `GET` | `/api/rooms/[slug]/tracks` | トラック一覧（position 昇順） | |
| `POST` | `/api/rooms/[slug]/tracks` | URL を受け取ってトラック追加 | `insertAfterTrackId` 指定で「その曲の直後」に挿入。未指定なら末尾。1ルームあたり最大 `MAX_TRACKS_PER_ROOM`（現状 1000）件。上限到達時は `409` |
| `PATCH` | `/api/rooms/[slug]/tracks/[trackId]` | 状態変更 | `status` / `position` の更新（再生完了時に `PLAYED` を書く） |
| `DELETE` | `/api/rooms/[slug]/tracks/[trackId]` | 削除 | |
| `POST` | `/api/rooms/[slug]/tracks/[trackId]/select` | クリック「ジャンプ」: 対象より前を `PLAYED`、対象+以降を `QUEUED` に書き換え | キュー上の任意の曲をクリックした際に呼ぶ。実際の再生開始は `emit("play")` がトリガー |
| `POST` | `/api/rooms/[slug]/tracks/reset` | `PLAYED/SKIPPED` を一括で `QUEUED` に戻す | ループ再生時のキュー循環 |

### その他

| Method | Path | 役割 |
|---|---|---|
| `POST` | `/api/metadata` | URL 単独でメタデータ取得（フォームのプレビュー用途など） |

### バリデーション

- 全て **Zod** で `safeParse`。失敗時は `400 { error }`
- ルームが存在しないパスは `404 { error: "Room not found" }` を返す

### トラック追加時の挿入ロジック（重要）

`POST /api/rooms/[slug]/tracks` で `insertAfterTrackId` が指定された場合：

1. `anchor` トラックを取得
2. `anchor.position` の直後から、**連続する `QUEUED` の塊**の末尾を探す
3. その次の `position` に挿入し、それ以降を `+1` シフト

これは「ループ中にA, B, C を追加したら、今の曲の直後に `[A, B, C, ...]` の順で積まれる」動作を実現するため。

```
Before:  [X:PLAYING, Y:QUEUED, Z:QUEUED]
Add A with insertAfter=X:
After:   [X, A, Y, Z]
Add B with insertAfter=X:
After:   [X, A, B, Y, Z]   ← B は A の直後（= 連続 QUEUED の末尾の次）
```

トランザクション (`prisma.$transaction`) で一括実行。

## 4. Socket.io ハンドラ

実装: `src/server/socket-handler.ts`。**ブロードキャスト専用**で、ここでは DB を更新しない（正本は REST API）。

### 参加者管理

- プロセス内 `Map<roomSlug, Map<socketId, Participant>>` で管理
- 複数インスタンス化する場合は Redis へ外出し必要（[infrastructure.md §6](./infrastructure.md#6-デプロイ未実装方針メモ)）

### イベント一覧

| イベント | クライアント → サーバー | サーバーの挙動 |
|---|---|---|
| `join_room` | `{ roomSlug, userName }` | DB で存在確認 → 鍵ありルームなら `socket.handshake.headers.cookie` の `xw_passcode_<slug>` を検証、不一致/欠落は `error` イベントで拒否 → ルーム参加 → `participants` ブロードキャスト |
| `leave_room` | `{ roomSlug }` | 退出 → `participants` ブロードキャスト |
| `track_added` | `{ roomSlug, trackId }` | 他の参加者に `track_added` を転送（各自が `GET /tracks` で refetch） |
| `queue_changed` | `{ roomSlug }` | 他の参加者に転送（削除などの通知用） |
| `play` / `pause` / `skip` | `{ roomSlug, trackId?, positionSec? }` | 他の参加者にそのまま転送 |
| `state_query` | `{ roomSlug }` | 同期ON にしたばかりの新規 listener が「いま何の曲？どこ？」と問い合わせ。サーバは `{ requesterSocketId }` を付けて他の参加者にブロードキャスト |
| `state_reply` | `{ requesterSocketId, trackId, positionSec }` | `state_query` を受けた listener の応答。サーバが `requesterSocketId` 宛にユニキャスト転送 |
| `settings_changed` | `{ roomSlug, loopPlayback }` | ループ設定変更を通知（DBは PATCH で既に更新済み） |
| `passcode_changed` | `{ roomSlug, passcode: string \| null }` | パスコード変更通知（DBは PATCH で既に更新済み）。サーバは中継のみで、受信側クライアントが自分の Cookie を `/auth` 経由で張り替え、自動追従する（[frontend.md §5](./frontend.md#5-パスコードゲート--管理モーダル) 参照） |
| `disconnect` | - | 参加者リストから除外 |

#### state_query / state_reply の挙動

- 新規 listener が同期 OFF→ON にした瞬間に `state_query` を 1 回だけ emit
- 受信した参加者全員が応答 → サーバは個別に転送 → **最初に届いた reply のみ採用**（race-based）
- 1 秒以内に reply が無ければ requester は「先頭の `QUEUED` 曲を 0 秒から」にフォールバック
- 永続的な位置同期は行わない（広告・バッファリング等で破綻するため意図的に廃止）

### 設計原則

- **"Socket は通知、REST は正本"**: Socket イベントを受けたら、状態変更は DB からの refetch または単発の REST 呼び出しで取得する
- **`emit` は `socket.to(roomSlug).emit(...)`**: 送信元以外にブロードキャスト（自分にエコーバックしない）
- **エラーハンドリング**: DB 失敗時は `socket.emit("error", { message })` で送信元に返す（クライアントでハンドリングが必要）

## 5. ルーム自動削除（空室 TTL）

参加者 0 人が一定日数続いたルームを自動削除する仕組み。鍵付きルームで Cookie を失って誰も削除できなくなったケースでも放置が無限に溜まらないようにするのが主目的。

### 仕組み

- `Room.lastOccupiedAt` に「最後に参加者がいた時刻」を記録
  - `join_room` / `leave_room` / `disconnect`（残り 0 人になった瞬間）で Socket ハンドラが `now()` に更新（`touchRoomOccupancy`）
  - 参加者が居続けているルームについては、クリーンアップ sweep のたびに `now()` に更新してずれ込み（プロセス再起動時含む）を吸収
- `src/server/room-cleanup.ts` の `runRoomCleanup()` が sweep 本体
  - 現在占有中（`participantsByRoom` に 1 人以上）のルームを一括 touch
  - `lastOccupiedAt < now - ROOM_INACTIVITY_TTL_DAYS` なルームを `deleteMany`（Track は `onDelete: Cascade` で連鎖削除）
- `server.ts` から `startRoomCleanup()` を呼んで `setInterval` で定期実行

### パラメータ（`src/lib/constants.ts`）

| 定数 | デフォルト | env | 用途 |
|---|---|---|---|
| `ROOM_INACTIVITY_TTL_DAYS` | `30` | `ROOM_INACTIVITY_TTL_DAYS` | 0 人状態がこの日数続いたら削除。将来的に `7` 等へ短縮する想定 |
| `ROOM_CLEANUP_INTERVAL_MS` | `3600000`（1h） | `ROOM_CLEANUP_INTERVAL_MS` | sweep 間隔。テストでは短縮する |

### 制約

- `participantsByRoom` はプロセス内 Map なので、複数インスタンス化すると「別インスタンスで参加者がいるのに touch されない」事故が起きる。現状は単一プロセス前提
- 鍵付きルーム所有者が Cookie を失うケースは、この TTL で時間経過後に自動解消される。ただし即時救済する仕組み（owner token など）は未実装

## 6. 共通ロジック（`src/lib/`）

| ファイル | 役割 |
|---|---|
| `constants.ts` | アプリ共通の定数。`MAX_TRACKS_PER_ROOM`（1ルームあたりのトラック上限）など |
| `prisma.ts` | PrismaClient のシングルトン。開発中は `globalThis` に保持してHMR時の多重生成を防ぐ |
| `platform.ts` | URL → `{ platform, externalId, normalizedUrl }` 判定。`youtu.be` / `youtube.com` / `soundcloud.com` / `nicovideo.jp` / `nico.ms` / `vimeo.com` / `*.wistia.com` / `*.wistia.net` に対応 |
| `metadata.ts` | 判定結果を元に以下のAPIを呼んでタイトル・サムネ・尺を取得。5秒タイムアウト。<br>・oEmbed: YouTube / SoundCloud / Vimeo / Wistia（Vimeo / Wistia は `duration` フィールド有り）<br>・`getthumbinfo`（XML）: ニコニコ動画 |
| `slug.ts` | ルームslug生成。混同しにくい文字（`0oil1` 除外）で8文字 |
| `passcode.ts` | ルームパスコード生成（`generateRoomPasscode`）と Zod スキーマ `RoomPasscodeSchema`。6桁大文字英数字 |
| `room-auth.ts` | パスコード Cookie ユーティリティ。`passcodeCookieName(slug)` / `parseCookieHeader(header)` / `verifyPasscodeFromCookieHeader(...)` / `buildSetPasscodeCookie(...)` / `buildClearPasscodeCookie(...)`。`next/headers` が使えない Socket.io 側でも使い回すため自前実装 |
| `socket.ts` | クライアント側 socket.io-client のシングルトン生成。path は `/api/socketio` |
| `utils.ts` | `cn()`（tailwind-merge+clsx）と `formatDuration()` |

## 7. サーバサイドモジュール（`src/server/`）

| ファイル | 役割 |
|---|---|
| `socket-handler.ts` | Socket.io のイベントハンドラ登録。参加者 Map の管理と `lastOccupiedAt` touch もここ |
| `room-cleanup.ts` | 空室 TTL に基づくルーム削除 sweep。`startRoomCleanup()` / `stopRoomCleanup()` / `runRoomCleanup()`（テスト用に同期呼び出し可） |

### プラットフォーム拡張の手順

新プラットフォームを追加するには：

1. `prisma/schema.prisma` の `enum Platform` に追加 → `migrate dev`
2. `src/lib/platform.ts` の `detectPlatform` に host 判定を追加
3. `src/lib/metadata.ts` の `fetchMetadata` に platform 分岐とメタ取得を追加（oEmbed の場合は `fetchOEmbed` を使い回せる）
4. `src/components/room/JukeboxPlayer.tsx` と `src/components/room/QueueList.tsx` の `platformLabel` に表示名を追加。再生方式は react-player で対応しているなら条件分岐だけでOK（独自 iframe が必要なら専用コンポーネント作成）
5. `next.config.ts` の `images.remotePatterns` にサムネドメインを追加し、`Permissions-Policy` の `autoplay` / `fullscreen` / `encrypted-media` 許可リストに埋め込みオリジンを追加
6. [architecture.md](./architecture.md) の System Context 図も更新

現在 react-player 経由で自動的に再生できるもの（追加実装不要で上記 1〜5 のみで動く）：Vimeo / Wistia。**ニコニコ動画** だけは react-player 未対応のため、独自 iframe + postMessage 実装（[frontend.md §JukeboxPlayer の再生制御](./frontend.md#4-jukeboxplayer-の再生制御) 参照）。

新規プラットフォームを検討する際の注意：react-player v2 の各アダプタが実際に動くかは SDK の状態次第で、採用前に必ず疎通確認すること。過去に検討したが見送った例：
- **Dailymotion**: 旧 Player API（`all.js`）が非推奨で Chrome で黒画面。新 Player Embed に自前で iframe 実装したが、広告ブロッカー無効環境では CM → 次のおすすめ動画の無限ループで `video_end` が飛ばないなど、挙動が不安定
- **Streamable**: `playerjs` SDK の WebSocket 接続が不安定で autoplay が入らない
- **Facebook / Twitch**: 独自認証や地域制限があり扱いが重い
