# Dead Beef Saloon（死んだ牛の酒場） / `0xDEADBEEF`

> *Dead Beef Saloon — where strangers buy the night a drink.*

YouTube / SoundCloud / ニコニコ動画 / Vimeo / Wistia のURLをキューに追加して再生できるジュークボックスWebサービス。
コードネームは `0xDEADBEEF`（開発者おなじみのマジックナンバー）。

- ソロモード: 自分だけのBGMプレイリスト
- パーティモード: ルームURLを共有してみんなで曲を追加（ホスト再生 / 同期再生）

## 技術スタック

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS
- react-player (YouTube / SoundCloud / Vimeo / Wistia) + ニコニコ動画は独自 iframe 実装
- Socket.io (リアルタイム通信)
- Prisma + PostgreSQL
- Docker + docker-compose

## クイックスタート

### 前提
- Docker Desktop
- Windows 11 + WSL2 で動かす場合は [docs/infrastructure.md §5](./docs/infrastructure.md#5-windows-11--wsl2-環境での注意点) も先に読む

### 初回起動

```bash
cp .env.example .env
docker compose up --build
```

別のターミナルでマイグレーションを実行:

```bash
docker compose exec app npx prisma migrate dev --name init
```

ブラウザで http://localhost:3000 を開く（Windows 11 の場合は `http://127.0.0.1:3000` を推奨、理由は [infrastructure.md §5.4](./docs/infrastructure.md#54-ブラウザからは-127001-を使う)）。

### 2回目以降

```bash
docker compose up          # 起動
docker compose down        # 停止
docker compose down -v     # DBごと消す
```

詳細は [docs/infrastructure.md](./docs/infrastructure.md) を参照。

## ドキュメント

設計やインフラの詳細は `docs/` にまとめている：

| ドキュメント | 内容 |
|---|---|
| [docs/architecture.md](./docs/architecture.md) | システム全体像・主要ユースケース・データモデル |
| [docs/backend.md](./docs/backend.md) | REST API / Prisma スキーマ / Socket.io ハンドラ |
| [docs/frontend.md](./docs/frontend.md) | App Router 構成・コンポーネント・状態管理・プラットフォーム固有の注意 |
| [docs/infrastructure.md](./docs/infrastructure.md) | Docker 構成・WSL2 + V6プラス のハマりどころ・デプロイ方針 |

AI エージェント向けの指針は [AGENTS.md](./AGENTS.md) にある。

## ディレクトリ構成

- `server.ts` — Next.js カスタムサーバー（Socket.io 統合）
- `src/app/` — App Router のページ・API Routes
- `src/components/` — React コンポーネント（`home/`, `room/`, `ui/`）
- `src/lib/` — 共通ロジック（URL判定、メタデータ取得、Prisma 等）
- `src/server/` — サーバー側ロジック（Socket.io ハンドラ）
- `prisma/schema.prisma` — DB スキーマ
- `docs/` — 設計ドキュメント

## ローカル開発（Dockerを使わない場合）

PostgreSQL 16 をローカルで動かしている前提。

```bash
npm install
npx prisma migrate dev --name init
npm run dev
```

## 開発フェーズ

- Phase 1: 基盤（ソロモード、URL追加、順次再生） — 実装済
- Phase 2: パーティモード（Socket.io、キュー同期） — 実装済
- Phase 3: 同期再生（ホスト→ゲストの再生位置同期） — 実装済
- Phase 4: 認証・投票・チャット・Capacitor によるアプリ化 — 未着手
