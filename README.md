# Dead Beef Saloon（死んだ牛の酒場） / `0xDEADBEEF`

> *Dead Beef Saloon — where strangers buy the night a drink.*

YouTube / SoundCloud / ニコニコ動画のURLをキューに追加して再生できるジュークボックスWebサービス。
コードネームは `0xDEADBEEF`（開発者おなじみのマジックナンバー）。

- ソロモード: 自分だけのBGMプレイリスト
- パーティモード: ルームURLを共有してみんなで曲を追加（ホスト再生 / 同期再生）

## 技術スタック

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS
- react-player (YouTube / SoundCloud / ニコニコ)
- Socket.io (リアルタイム通信)
- Prisma + PostgreSQL
- Docker + docker-compose

## 起動方法

### 前提
- Docker Desktop

### 初回起動

```bash
cp .env.example .env
docker compose up --build
```

別のターミナルでマイグレーションを実行:

```bash
docker compose exec app npx prisma migrate dev --name init
```

ブラウザで http://localhost:3000 を開く。

### 2回目以降

```bash
docker compose up
```

### 停止

```bash
docker compose down
```

DBごと消す場合:

```bash
docker compose down -v
```

### DBにホストから繋ぎたい場合（Prisma Studio等）

デフォルトではDBコンテナのポートを外部に公開していません。ホストから繋ぎたい場合は
`docker-compose.yml` の `db` サービスに以下を追加してください:

```yaml
    ports:
      - "5433:5432"
```

その上で `.env` に以下を追加:

```
DATABASE_URL=postgresql://jukebox:jukebox@localhost:5433/jukebox?schema=public
```

## ローカル開発（Dockerを使わない場合）

PostgreSQL 16 をローカルで動かしている前提。

```bash
npm install
npx prisma migrate dev --name init
npm run dev
```

## ディレクトリ構成

- `server.ts` — Next.js カスタムサーバー（Socket.io 統合）
- `src/app/` — App Router のページ・API Routes
- `src/components/` — React コンポーネント
- `src/lib/` — 共通ロジック（URL判定、メタデータ取得など）
- `src/server/` — サーバー側ロジック（Socket.io ハンドラ）
- `prisma/schema.prisma` — DB スキーマ

## 開発フェーズ

- Phase 1: 基盤（ソロモード、URL追加、順次再生）
- Phase 2: パーティモード（Socket.io、キュー同期）
- Phase 3: 同期再生（ホスト→ゲストの再生位置同期）
- Phase 4: 認証・投票・チャット・Capacitor によるアプリ化
