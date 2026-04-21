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
| `mode` | `SOLO \| PARTY` | 単独 / 共有 |
| `playbackMode` | `HOST \| SYNC` | パーティ時の再生方式 |
| `loopPlayback` | `boolean` | キュー末尾到達後にリセットして繰り返すか |
| `hostId` | `string?` | 将来の認証用（現状未使用） |

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
RoomMode      = SOLO | PARTY
PlaybackMode  = HOST | SYNC
TrackStatus   = QUEUED | PLAYING | PLAYED | SKIPPED
```

### インデックス

- `Room(slug)` unique
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
| `GET` | `/api/rooms` | ルーム一覧（updatedAt 降順、50件） | |
| `POST` | `/api/rooms` | ルーム作成 | `name`, `mode`, `playbackMode`, `isPublic`。slug 衝突時は5回までリトライ生成 |
| `GET` | `/api/rooms/[slug]` | 単一ルーム取得（tracks 込み） | |
| `PATCH` | `/api/rooms/[slug]` | ルーム設定更新 | `loopPlayback`, `playbackMode`, `name` の部分更新 |
| `DELETE` | `/api/rooms/[slug]` | ルーム削除 | `onDelete: Cascade` でトラックも削除 |

### Tracks

| Method | Path | 役割 | 備考 |
|---|---|---|---|
| `GET` | `/api/rooms/[slug]/tracks` | トラック一覧（position 昇順） | |
| `POST` | `/api/rooms/[slug]/tracks` | URL を受け取ってトラック追加 | `insertAfterTrackId` 指定で「その曲の直後」に挿入。未指定なら末尾 |
| `PATCH` | `/api/rooms/[slug]/tracks/[trackId]` | 状態変更 | `status` / `position` の更新（再生完了時に `PLAYED` を書く） |
| `DELETE` | `/api/rooms/[slug]/tracks/[trackId]` | 削除 | |
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
| `join_room` | `{ roomSlug, userName }` | DB で存在確認 → ルーム参加 → `participants` ブロードキャスト |
| `leave_room` | `{ roomSlug }` | 退出 → `participants` ブロードキャスト |
| `track_added` | `{ roomSlug, trackId }` | 他の参加者に `track_added` を転送（各自が `GET /tracks` で refetch） |
| `queue_changed` | `{ roomSlug }` | 他の参加者に転送（削除などの通知用） |
| `play` / `pause` / `skip` | `{ roomSlug, trackId?, positionSec? }` | 他の参加者にそのまま転送 |
| `sync_state` | `{ roomSlug, trackId, positionSec }` | SYNC モード時、ホストが定期送信。ゲストが `seekTo` で合わせる |
| `settings_changed` | `{ roomSlug, loopPlayback }` | ループ設定変更を通知（DBは PATCH で既に更新済み） |
| `disconnect` | - | 参加者リストから除外 |

### 設計原則

- **"Socket は通知、REST は正本"**: Socket イベントを受けたら、状態変更は DB からの refetch または単発の REST 呼び出しで取得する
- **`emit` は `socket.to(roomSlug).emit(...)`**: 送信元以外にブロードキャスト（自分にエコーバックしない）
- **エラーハンドリング**: DB 失敗時は `socket.emit("error", { message })` で送信元に返す（クライアントでハンドリングが必要）

## 5. 共通ロジック（`src/lib/`）

| ファイル | 役割 |
|---|---|
| `prisma.ts` | PrismaClient のシングルトン。開発中は `globalThis` に保持してHMR時の多重生成を防ぐ |
| `platform.ts` | URL → `{ platform, externalId, normalizedUrl }` 判定。`youtu.be` / `youtube.com` / `soundcloud.com` / `nicovideo.jp` / `nico.ms` / `vimeo.com` / `*.wistia.com` / `*.wistia.net` に対応 |
| `metadata.ts` | 判定結果を元に以下のAPIを呼んでタイトル・サムネ・尺を取得。5秒タイムアウト。<br>・oEmbed: YouTube / SoundCloud / Vimeo / Wistia（Vimeo / Wistia は `duration` フィールド有り）<br>・`getthumbinfo`（XML）: ニコニコ動画 |
| `slug.ts` | ルームslug生成。混同しにくい文字（`0oil1` 除外）で8文字 |
| `socket.ts` | クライアント側 socket.io-client のシングルトン生成。path は `/api/socketio` |
| `utils.ts` | `cn()`（tailwind-merge+clsx）と `formatDuration()` |

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
