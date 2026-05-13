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
- Socket.io の CORS は env `ALLOWED_ORIGINS`（カンマ区切り）でホワイトリスト指定。未設定時はリクエストオリジンを反映（同一オリジン前提）。`credentials: true` で handshake に passcode Cookie を載せる

## 2. Prisma スキーマ

正本は `prisma/schema.prisma`。主要モデル：

### Room

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | `cuid` | 主キー |
| `slug` | `string` unique | URL に使う短いID（`generateRoomSlug()` で 8 文字、誤認しにくいアルファベット） |
| `loopPlayback` | `boolean` | キュー末尾到達後にリセットして繰り返すか |
| `shufflePlayback` | `boolean` | 次曲決定を「`QUEUED` 集合からランダム1つ」に切り替えるか。`loopPlayback` とは独立フラグ。ループON+シャッフルON で全消化 → reset 後の1曲目は「直前まで流れていた曲」を候補から除外（候補が0件になるなら除外無視） |
| `hostId` | `string?` | 将来の認証用（現状未使用） |
| `passcode` | `string?` | オンラインゲームのロビー風のパスコード。`null`=鍵なし、6桁の大文字英数字（`0/O/1/I/L` 除外）。**平文保存**（ルーム内メンバーが閲覧可能であること自体が要件のため）|
| `lastOccupiedAt` | `datetime` | 参加者が最後に居た（または現在居る）時刻。空室 TTL クリーンアップの基準。Socket ハンドラの `join_room` / `leave_room` / `disconnect`（参加者 0 人化時）と、`room-cleanup` の sweep で更新する |

> 「この端末で『聴く』か（音声出力するか）」はルーム設定ではなく **per-user / per-device の localStorage 設定**。詳細は [frontend.md §3](./frontend.md#3-roomclient-の状態管理) を参照。

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
| `GET` | `/api/rooms` | ルーム一覧（updatedAt 降順、50件） | **鍵なしルームのみ** を返す（`where: { passcode: null }`）。鍵付きルームは「URL を共有された人だけが入る」想定なので一覧に出さない。各 room に `hasPasscode: false` が付く（常に false） |
| `POST` | `/api/rooms` | ルーム作成 | `name`, `withPasscode`（任意）, `passcode`（任意、6桁英数字）。`passcode` 明示時はその値で保存（フォームが事前生成した値をそのまま使うため）。未指定かつ `withPasscode=true` ならサーバ側で自動生成。いずれの場合も成功レスポンス body と Set-Cookie で passcode を返す。**全体で `MAX_ROOMS_TOTAL`（現状 100）件**を超えると `409` |
| `GET` | `/api/rooms/[slug]` | 単一ルーム取得（tracks 込み） | 鍵ありルームは Cookie `xw_passcode_<slug>` が一致した場合のみ 200。不一致/欠落は `401` |
| `PATCH` | `/api/rooms/[slug]` | ルーム設定更新 | `loopPlayback`, `shufflePlayback`, `name`, `passcode` の部分更新。`passcode: "regenerate"` で生成/再生成、`passcode: null` で解除。鍵ありルームの操作は Cookie 必須、鍵なし→鍵ありの「初回設定」だけは誰でも可 |
| `DELETE` | `/api/rooms/[slug]` | ルーム削除 | `onDelete: Cascade` でトラックも削除。鍵あり時は Cookie 必須 |
| `POST` | `/api/rooms/[slug]/auth` | パスコード認証 | body `{ passcode }` を検証、一致で `xw_passcode_<slug>` Cookie を Set（HttpOnly / SameSite=Lax / Max-Age=30d、本番は Secure 付）。比較は `crypto.timingSafeEqual` で定数時間。**IP+slug 単位のレートリミット**（デフォルト 5回/5分、超過で 15分ロック → `429` + `Retry-After`）。詳細は [§3 レートリミット](#レートリミットpost-roomsslug-auth) |
| `DELETE` | `/api/rooms/[slug]/auth` | パスコード Cookie クリア | Max-Age=0 の Set-Cookie を返す |

### Tracks

| Method | Path | 役割 | 備考 |
|---|---|---|---|
| `GET` | `/api/rooms/[slug]/tracks` | トラック一覧（position 昇順） | 鍵ありルームは Cookie 必須。不一致/欠落は `401` |
| `POST` | `/api/rooms/[slug]/tracks` | URL を受け取ってトラック追加 | 常にキューの末尾に追加（`position = max + 1`）。1ルームあたり最大 `MAX_TRACKS_PER_ROOM`（現状 1000）件。上限到達時は `409`。鍵ありルームは Cookie 必須 |
| `PATCH` | `/api/rooms/[slug]/tracks/[trackId]` | 状態変更 | `status` / `position` の更新（再生完了時に `PLAYED` を書く）。鍵ありルームは Cookie 必須 |
| `DELETE` | `/api/rooms/[slug]/tracks/[trackId]` | 削除 | 鍵ありルームは Cookie 必須 |
| `POST` | `/api/rooms/[slug]/tracks/[trackId]/select` | クリック「ジャンプ」: 対象より前を `PLAYED`、対象+以降を `QUEUED` に書き換え | キュー上の任意の曲をクリックした際に呼ぶ。実際の再生開始は `emit("play")` がトリガー。鍵ありルームは Cookie 必須 |
| `POST` | `/api/rooms/[slug]/tracks/reset` | `PLAYED/SKIPPED` を一括で `QUEUED` に戻す | ループ再生時のキュー循環。鍵ありルームは Cookie 必須 |

### その他

| Method | Path | 役割 |
|---|---|---|
| `POST` | `/api/metadata` | URL 単独でメタデータ取得（フォームのプレビュー用途など） |

### バリデーション

- 全て **Zod** で `safeParse`。失敗時は `400 { error }`
- ルームが存在しないパスは `404 { error: "Room not found" }` を返す

### 認可・CSRF（書き込み系全般の共通仕様）

- **認可（passcode Cookie）**: 鍵ありルーム配下の REST は `xw_passcode_<slug>` Cookie の一致が必要。共通ヘルパ `isAuthorizedForRoom(slug, room.passcode)` を `src/lib/room-auth-server.ts` に集約。GET 系（`/api/rooms/[slug]`、`/api/rooms/[slug]/tracks`）も「鍵あり時は Cookie 必須」を一律適用し、トラック一覧の透けを防ぐ。
- **CSRF（Origin / Referer 検証）**: state を変更するメソッド（`POST` / `PATCH` / `PUT` / `DELETE`）は `isSameOriginRequest(req)` を冒頭で呼び、不一致なら `403 { error: "Forbidden" }`。許可オリジンは「リクエスト Host 自身（http/https 両方）+ env `ALLOWED_ORIGINS`（カンマ区切り）」の和集合。Origin / Referer のいずれか一方でも欠ける/不一致なら拒否（保守的）。
- **適用対象**: `POST /api/rooms`、`PATCH/DELETE /api/rooms/[slug]`、`POST/DELETE /api/rooms/[slug]/auth`、`/api/rooms/[slug]/tracks` 配下全部、`POST /api/metadata`。
- **Cookie 属性**: `HttpOnly` / `SameSite=Lax` / `Max-Age=30d` に加え、`COOKIE_SECURE=true` または `NODE_ENV=production` のとき `Secure` を付与。HSTS (`Strict-Transport-Security: max-age=63072000; includeSubDomains`) は本番ビルドのみ `next.config.ts` から付与。

### レートリミット（`POST /api/rooms/[slug]/auth`）

passcode のブルートフォース緩和。実装は `src/lib/rate-limit.ts`（プロセス内 Map ベース、IP+slug 単位）。

| パラメータ | デフォルト | env | 用途 |
|---|---|---|---|
| `AUTH_RATE_LIMIT_MAX` | `5` | `AUTH_RATE_LIMIT_MAX` | ウィンドウ内に許容する 401 失敗回数 |
| `AUTH_RATE_LIMIT_WINDOW_SEC` | `300` | `AUTH_RATE_LIMIT_WINDOW_SEC` | カウントウィンドウ秒 |
| `AUTH_RATE_LIMIT_LOCK_SEC` | `900` | `AUTH_RATE_LIMIT_LOCK_SEC` | MAX 到達時のロック秒（= `Retry-After` ヘッダ） |

仕様：

- **キー**: `${ip}:${slug}`。IP は `x-forwarded-for` の最初の値 → `x-real-ip` の順でフォールバック。両方無ければレートリミット自体を skip（dev / SSR 内部呼び出し用）
- **カウント対象**: `401`（passcode 不一致）のみ。`400`（フォーマット違反）はカウントしない
- **ロック中の応答**: `429 Too Many Requests` + `Retry-After: <秒>` ヘッダ + body `{ error: "試行回数が多すぎます。N 分後にやり直してください。" }`。**ロック中の追加失敗は `lockedUntil` を延長しない**（タイマー延長攻撃防止）
- **成功時**: 即時カウンタリセット（`clearAuthRateLimit`）。誤入力 4 回 → 5 回目で正解、のような正規ユーザーが次回も 5 回猶予を得られる
- **メモリ DoS 対策**: `MAX_BUCKETS=10000` を超えたら挿入順 (FIFO) で古い key を破棄
- **タイミング攻撃緩和**: passcode 比較は `crypto.timingSafeEqual` で定数時間。文字列 `===` は文字単位短絡評価で正解の頭文字が漏れる

理論上のブルートフォース耐性: 単独 IP・デフォルト値（5/300/900）で **約 5,900 年** 必要（6 桁 31 文字種 = 8.8 億通り）。複数インスタンス化したら破綻する（Map がプロセス内）ので、その時点で Redis ベースに移行するか前段（Cloudflare / nginx）に任せる。

### トラック追加時の挿入ロジック

`POST /api/rooms/[slug]/tracks` は **常に末尾追加** だけを行う（`position = max(position) + 1`）。ループ ON / OFF や現在再生中の曲の有無に関わらず、挙動は同じ。トランザクション (`prisma.$transaction`) で max 取得→ insert を一括実行。

「自分の曲をすぐ聴きたい」場合はクライアント側でその曲をクリックすればよい（`POST /tracks/[trackId]/select` でクリック前を `PLAYED`、以降を `QUEUED` に書き換えてジャンプする）。

## 4. Socket.io ハンドラ

実装: `src/server/socket-handler.ts`。**ブロードキャスト専用**で、ここでは DB を更新しない（正本は REST API）。

### 参加者管理

- プロセス内 `Map<roomSlug, Map<socketId, Participant>>` で管理
- 複数インスタンス化する場合は Redis へ外出し必要（[infrastructure.md §6](./infrastructure.md#6-デプロイ未実装方針メモ)）

### イベント一覧

| イベント | クライアント → サーバー | サーバーの挙動 |
|---|---|---|
| `join_room` | `{ roomSlug, userName }` | DB で存在確認 → 鍵ありルームなら `socket.handshake.headers.cookie` の `xw_passcode_<slug>` を検証、不一致/欠落は `error` イベントで拒否 → ルーム参加 → `participants` ブロードキャスト → `socket` 内の `session` に `{ roomSlug }` を保持（後続イベントの認可基盤） |
| `leave_room` | `{ roomSlug }` | 自分が join しているルームのみ受け付ける。退出 → `participants` ブロードキャスト → `session` クリア |
| `track_added` | `{ roomSlug, trackId }` | **sender が `roomSlug` に join 済みかチェック**。OK なら他の参加者に `track_added` を転送（各自が `GET /tracks` で refetch） |
| `queue_changed` | `{ roomSlug }` | sender の join チェック後、他の参加者に転送（削除などの通知用） |
| `play` / `pause` / `skip` | `{ roomSlug, trackId?, positionSec? }` | sender の join チェック後、他の参加者にそのまま転送 |
| `state_query` | `{ roomSlug }` | sender の join チェック後、`{ requesterSocketId }` を付けて他の参加者にブロードキャスト |
| `state_reply` | `{ requesterSocketId, trackId, positionSec }` | sender がどこかにルーム join 済みであることだけ確認 → `requesterSocketId` 宛にユニキャスト転送 |
| `settings_changed` | `{ roomSlug, loopPlayback?, shufflePlayback? }` | sender の join チェック後、ループ / シャッフル設定変更を通知（DBは PATCH で既に更新済み）。受信側は受け取った boolean プロパティだけ反映する |
| `passcode_changed` | `{ roomSlug }` | sender の join チェック後、**サーバが DB から現在の `Room.passcode` を読み**、`{ passcode }` を中継。クライアントが渡した値は信用しない（第三者の `{ passcode: null }` 撃ち込みでメンバーが締め出されるのを防ぐ） |
| `disconnect` | - | 参加者リストから除外 |

#### 認可ガード（`ensureJoined`）

`join_room` 以外の全イベントで「sender の `socket.data.session.roomSlug === payload.roomSlug` か」を `ensureJoined()` でチェックし、不一致は `error: "Not joined"` を本人に返して broadcast しない。これにより：

- 鍵付きルームの slug を知っているだけの第三者が任意の `play` / `pause` / `passcode_changed` を撃ち込めなくなる
- ルーム A に join 済みのユーザーが、ルーム B に向けて emit してもブロックされる

`session` は `join_room` 成功時に確立し、`leave_room` / `disconnect` で破棄する。1 socket = 1 ルームの前提。

#### state_query / state_reply の挙動

- 新規 listener が「聴く」を OFF→ON にした瞬間に `state_query` を 1 回だけ emit
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
| `constants.ts` | アプリ共通の定数。`MAX_TRACKS_PER_ROOM`（1ルームあたりのトラック上限。env `MAX_TRACKS_PER_ROOM` で上書き可、デフォルト 1000）、`MAX_ROOMS_TOTAL`（アプリ全体のルーム数上限。env `MAX_ROOMS_TOTAL` で上書き可、デフォルト 100）など |
| `prisma.ts` | PrismaClient のシングルトン。開発中は `globalThis` に保持してHMR時の多重生成を防ぐ |
| `platform.ts` | URL → `{ platform, externalId, normalizedUrl }` 判定。`youtu.be` / `youtube.com` / `soundcloud.com` / `nicovideo.jp` / `nico.ms` / `vimeo.com` / `*.wistia.com` / `*.wistia.net` に対応 |
| `metadata.ts` | 判定結果を元に以下のAPIを呼んでタイトル・サムネ・尺を取得。5秒タイムアウト。<br>・oEmbed: YouTube / SoundCloud / Vimeo / Wistia（Vimeo / Wistia は `duration` フィールド有り）<br>・`getthumbinfo`（XML）: ニコニコ動画 |
| `slug.ts` | ルームslug生成。混同しにくい文字（`0oil1` 除外）で8文字。**CSPRNG (`crypto.randomInt`) で生成**（予測攻撃対策） |
| `passcode.ts` | ルームパスコード生成（`generateRoomPasscode`）と Zod スキーマ `RoomPasscodeSchema`。6桁大文字英数字。**CSPRNG (`crypto.randomInt`) で生成**（`Math.random` の xorshift128+ は内部状態が出力数個から逆算可能なため使用不可） |
| `room-auth.ts` | パスコード Cookie ユーティリティ（**Socket.io / エッジ非依存側**）。`passcodeCookieName(slug)` / `parseCookieHeader(header)` / `verifyPasscodeFromCookieHeader(...)` / `buildSetPasscodeCookie(...)` / `buildClearPasscodeCookie(...)`。`Set-Cookie` の `Secure` 属性は `COOKIE_SECURE=true` または `NODE_ENV=production` のとき自動付与 |
| `room-auth-server.ts` | **Next.js Route Handler 専用**の認可・CSRF ヘルパ。`readPasscodeCookie(slug)`（`next/headers` 経由）、`isAuthorizedForRoom(slug, room.passcode)`（鍵あり時のみ Cookie 検証）、`isSameOriginRequest(req)`（CSRF: Origin/Referer 検証、許可リストは `ALLOWED_ORIGINS` env + リクエスト Host）、`unauthorizedResponse()` / `forbiddenResponse()`。Socket.io 側からは import しないこと（`next/headers` 依存） |
| `rate-limit.ts` | プロセス内 Map ベースの単純なレートリミッタ（IP+slug 単位）。`checkAuthRateLimit(key)` / `recordAuthFailure(key)` / `clearAuthRateLimit(key)` / `clientIpFromRequest(req)`。閾値は `constants.ts` の `AUTH_RATE_LIMIT_*` から読む。プロセス間共有なし（複数インスタンス化したら Redis 等に外出しが必要） |
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
