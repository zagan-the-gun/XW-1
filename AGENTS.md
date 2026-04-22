# AGENTS.md

> AI コーディングエージェント（Cursor / Copilot / Claude Code 等）向けの作業ガイド。
> 人間向けの情報は [README.md](./README.md) と [docs/](./docs/README.md) を参照。

## プロジェクト概要

Dead Beef Saloon (`0xDEADBEEF`) は YouTube / SoundCloud / ニコニコ動画 / Vimeo / Wistia のURLをキューに入れて再生するジュークボックスWeb アプリ。

- **スタック**: Next.js 15 (App Router) + TypeScript + Tailwind + Socket.io + Prisma + PostgreSQL
- **構成**: カスタムサーバー (`server.ts`) で Next.js と Socket.io を同居させ、`docker compose` で `app` + `db` を起動

## 読み込み順序

作業開始時はこの順序でファイルを読むと文脈が最短で揃う：

1. [README.md](./README.md) — プロジェクト概要
2. [docs/architecture.md](./docs/architecture.md) — システム全体像・データモデル・主要ユースケース
3. タスク種別に応じて：
   - サーバー側の追加・修正 → [docs/backend.md](./docs/backend.md) + `src/server/`, `src/app/api/`, `prisma/`
   - フロント側の追加・修正 → [docs/frontend.md](./docs/frontend.md) + `src/components/`, `src/app/`
   - 環境・ビルド・Docker 周り → [docs/infrastructure.md](./docs/infrastructure.md) + `Dockerfile`, `docker-compose.yml`
4. 該当ソースを読み、変更を計画

## 作業ルール

### 変更時に必ず守ること

- **スキーマ変更**: `prisma/schema.prisma` を変更したら `prisma/migrations/` を生成し、[docs/architecture.md](./docs/architecture.md) の ER 図と [docs/backend.md](./docs/backend.md) のテーブル表を更新
- **API 追加・変更**: [docs/backend.md](./docs/backend.md) のエンドポイント一覧を更新
- **Socket.io イベント追加・変更**: [docs/backend.md](./docs/backend.md) のイベント表と [docs/frontend.md](./docs/frontend.md) のリスナー責務を更新
- **新コンポーネント追加**: [docs/frontend.md](./docs/frontend.md) のコンポーネント構成図を更新
- **新プラットフォーム対応**: [docs/backend.md](./docs/backend.md#プラットフォーム拡張の手順) の手順に従う

### コーディング規約

- **TypeScript** strict。`any` は避け、どうしても必要なら `eslint-disable-next-line` コメントで理由を記す
- **Zod** で入力バリデーション（`src/app/api/*/route.ts` のパターンを踏襲）
- **Prisma Client** は `src/lib/prisma.ts` のシングルトンを使う（新たに `new PrismaClient()` しない）
- **クライアント状態** は `useState` ベース。Redux 等のグローバル状態管理は導入しない
- **Socket は通知、REST は正本**: Socket ハンドラで DB を更新しない。Socket を受けたら `GET /tracks` で refetch させる。**例外**: `Room.lastOccupiedAt` の touch は Socket ハンドラで行う（空室 TTL クリーンアップ用のライブネス信号。ドメイン状態ではない。詳細は [docs/backend.md §5](./docs/backend.md#5-ルーム自動削除空室-ttl)）
- **コメント**: コードから自明な内容は書かない。非自明な制約・トレードオフだけ書く（例: ニコニコ動画の postMessage プロトコル実装コメント）
- **絵文字は使わない**（ユーザー要望）

### やってはいけないこと

- `HOSTNAME` 環境変数を `server.ts` や新コードで読む（理由: [docs/infrastructure.md §5.5](./docs/infrastructure.md#55-hostname-環境変数の罠)）。使うなら `HOST`
- `/mnt/c/` 配下で作業する（WSL2 環境の場合。極端に遅い）
- Socket.io の `participantsByRoom` Map を外部永続化なしに複数インスタンス前提で扱う（現状プロセス内のみ）
- 不要な `console.log` の残留（`src/lib/prisma.ts` のように意図的なものはOK）

## よくあるタスクの勘所

### 新しい曲プラットフォームの対応

[docs/backend.md §プラットフォーム拡張の手順](./docs/backend.md#プラットフォーム拡張の手順) に従う。要点：

1. `Platform` enum に追加 → migrate
2. `detectPlatform` に URL 判定を追加
3. `fetchMetadata` に oEmbed 呼び出しを追加
4. `JukeboxPlayer` に再生方式を追加（react-player で十分か、独自 iframe が要るか確認）
5. `next.config.ts` の `images.remotePatterns` にサムネドメイン追加

### キュー操作ロジックの変更

`src/app/api/rooms/[slug]/tracks/route.ts` の挿入ロジック（`insertAfterTrackId` と連続QUEUED塊の検出）と、`src/components/room/RoomClient.tsx` の `handleAdded` の楽観的更新が対応していることを確認する。不整合になると「追加位置がブラウザとDBで違う」という表示バグになりがち。

### Socket.io イベント追加

- サーバー側: `src/server/socket-handler.ts` にハンドラ追加
- クライアント側: `src/components/room/RoomClient.tsx` の `useEffect` でリスナー追加＆クリーンアップを対で書く
- 最新値を参照する場合は `latestRef.current` を使う（依存配列肥大化を避けるため）
- 両方の [docs](./docs/) を同時に更新

## 検証

変更後は以下を確認：

- `docker compose exec app npm run lint` が通る
- `docker compose exec app npx prisma generate` が通る（スキーマ変更時）
- `docker compose exec app npm test` が通る（Vitest: ユニット / API / Socket.io）
    - 初回は `docker compose exec app npm run test:setup` でテスト DB を用意
- UI に影響する変更があれば `npm run test:e2e` も流す（Playwright、ホスト実行。事前に `npx playwright install chromium`）
- 手元で `http://127.0.0.1:3000/` を開いて動作確認（Windows の場合）

## 質問があるとき

コードから読み取れない意思決定（「なぜ Redis じゃなくてプロセス内Map？」等）は、まず [docs/architecture.md §6 開発フェーズ](./docs/architecture.md#6-開発フェーズ) の制約を確認する。そこにも無ければユーザーに確認する。
