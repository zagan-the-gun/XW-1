# Architecture

> Dead Beef Saloon（`0xDEADBEEF`）の全体像。システム境界・主要コンポーネント・ユースケースの流れを把握するためのドキュメント。
> 個別の実装詳細は [backend.md](./backend.md) / [frontend.md](./frontend.md) / [infrastructure.md](./infrastructure.md) を参照。

## 1. System Context（C4 Level 1）

```mermaid
flowchart LR
    User((ユーザー<br/>ホスト / ゲスト))
    Browser[ブラウザ]
    App["Dead Beef Saloon<br/>(Next.js + Socket.io)"]
    DB[(PostgreSQL 16)]
    YT[YouTube<br/>oEmbed / Player]
    SC[SoundCloud<br/>oEmbed / Player]
    NICO[ニコニコ動画<br/>getthumbinfo / embed]
    OTHER[Vimeo / Wistia<br/>oEmbed / Player]

    User --> Browser
    Browser <-->|HTTP/WebSocket| App
    App <--> DB
    App -->|メタデータ取得| YT
    App -->|メタデータ取得| SC
    App -->|メタデータ取得| NICO
    App -->|メタデータ取得| OTHER
    Browser -->|iframe/Player SDK| YT
    Browser -->|iframe/Player SDK| SC
    Browser -->|iframe| NICO
    Browser -->|iframe/Player SDK| OTHER
```

- **ユーザー**: ルームを作成する人（ホスト）と URL で参加する人（ゲスト）の 2 ロール（現状は認証なし、`localStorage` にランダムな `guest-xxxx` を保存）
- **外部サービス**: 各プラットフォームの oEmbed / thumbinfo API からメタデータを取得。実際のストリーミングはブラウザで直接行う（サーバーは中継しない）

## 2. Container（C4 Level 2）

```mermaid
flowchart TB
    subgraph browser[ブラウザ]
        RC[RoomClient<br/>React Client Component]
        JP[JukeboxPlayer<br/>react-player / niconico iframe]
    end

    subgraph server[Next.js サーバー]
        Pages[App Router Pages<br/>SSR]
        API[REST API Routes<br/>/api/*]
        WS[Socket.io サーバー<br/>/api/socketio]
        Lib[lib/<br/>platform / metadata / prisma]
    end

    DB[(PostgreSQL)]
    Ext[外部 API<br/>YouTube / SoundCloud / ニコニコ動画 /<br/>Vimeo / Wistia]

    RC -->|fetch| API
    RC <-->|WebSocket| WS
    JP -->|embed/SDK| Ext
    Pages -->|prisma.*| DB
    API -->|prisma.*| DB
    API --> Lib
    WS --> Lib
    Lib -->|metadata| Ext
```

- **Pages（SSR）**: トップ (`/`) とルーム (`/room/[slug]`) の初期HTMLをサーバー側で生成
- **REST API**: ルーム・トラックの CRUD、メタデータ取得。状態を変更する操作の正本はここ
- **Socket.io**: パーティモード時のみ利用。イベントはブロードキャスト専用で、**DBの正本は REST API が握る**（Socketは"変更を通知するだけ"で、受け取った側は DB から refetch する）
- **`lib/`**: URL 判定・oEmbed 呼び出し・Prisma クライアント等の共通ロジック

## 3. データモデル概要

詳細は [backend.md](./backend.md#prisma-スキーマ) と `prisma/schema.prisma`。主要な関係：

```mermaid
erDiagram
    User ||--o{ Room : "hosts"
    User ||--o{ Track : "adds"
    Room ||--o{ Track : "has queue"

    Room {
        string slug UK
        enum mode "SOLO|PARTY"
        enum playbackMode "HOST|SYNC"
        bool loopPlayback
    }
    Track {
        enum platform "YOUTUBE|SOUNDCLOUD|NICONICO|VIMEO|WISTIA"
        int position
        enum status "QUEUED|PLAYING|PLAYED|SKIPPED"
    }
```

- `Room.slug` がパス・共有URLのキー（例: `/room/abc12xyz`）
- `Track.position` でキュー順を管理（挿入時に後続を `+1` シフト）
- `Track.status` で再生済みを区別し、ループ時は `PLAYED/SKIPPED` → `QUEUED` に一括戻し

## 4. 主要ユースケースのシーケンス

### 4.1 ソロ: URLを追加して再生

```mermaid
sequenceDiagram
    participant U as User
    participant B as Browser (RoomClient)
    participant A as Next.js API
    participant D as DB
    participant E as 外部 API

    U->>B: URL を貼って「追加」
    B->>A: POST /api/rooms/{slug}/tracks
    A->>E: detectPlatform → oEmbed 取得
    E-->>A: title / thumbnail / duration
    A->>D: track 作成 (position末尾)
    A-->>B: { track }
    B->>B: state に追加 → JukeboxPlayer 再生
    Note over B: PLAYED になったら PATCH /tracks/{id}
```

### 4.2 パーティ: 複数人で曲を追加・再生

```mermaid
sequenceDiagram
    participant H as Host Browser
    participant G as Guest Browser
    participant S as Socket.io
    participant A as REST API
    participant D as DB

    H->>S: join_room
    G->>S: join_room
    S-->>H: participants
    S-->>G: participants

    G->>A: POST /tracks (曲追加)
    A->>D: create
    A-->>G: { track }
    G->>S: emit track_added
    S-->>H: track_added
    H->>A: GET /tracks (refetch)
    A->>D: select
    A-->>H: { tracks }
    H->>H: JukeboxPlayer 更新

    Note over H,G: 再生の正本はホスト<br/>(playbackMode=HOST)
    H->>S: emit play { trackId }
    S-->>G: play event
    G->>G: (SYNC モードなら<br/>seekTo で時刻合わせ)
```

### 4.3 ループ再生

キュー全消化後に `PLAYED/SKIPPED` なトラックを全て `QUEUED` に戻して先頭から再開する。新規追加は「今かかっている曲の直後」に挿入されるので、割り込みと循環が共存できる。

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Playing: track 追加 or 選択
    Playing --> Playing: onEnded → 次のQUEUED
    Playing --> ResetQueue: loopPlayback=true<br/>かつ 後続QUEUEDなし
    ResetQueue --> Playing: POST /tracks/reset<br/>全トラックをQUEUEDに戻す
    Playing --> Idle: loopPlayback=false<br/>かつ 後続QUEUEDなし
```

## 5. モードとスイッチ

| モード / 設定 | 値 | 説明 |
|---|---|---|
| `Room.mode` | `SOLO` | 単独プレイ。Socket.io は未接続 |
| | `PARTY` | 複数人で共有。Socket.io で参加者同期 |
| `Room.playbackMode` | `HOST` | ホストのブラウザのみ再生。ゲストは参加者リストとキューを見る |
| | `SYNC` | 全員のブラウザで同時再生。ホストが `sync_state` を定期送信し、ゲストは `seekTo` で合わせる |
| `Room.loopPlayback` | `true` | キュー全消化後、全 `PLAYED/SKIPPED` を `QUEUED` に戻して繰り返し |
| | `false` | キュー消化で停止 |

## 6. 開発フェーズ

| Phase | 内容 | 状態 |
|---|---|---|
| 1 | 基盤（ソロモード、URL追加、順次再生） | 実装済 |
| 2 | パーティモード（Socket.io、キュー同期） | 実装済 |
| 3 | 同期再生（ホスト→ゲストの再生位置同期） | 実装済 |
| 4 | 認証・投票・チャット・Capacitor によるアプリ化 | 未着手 |

現時点の制約：

- 認証なし。`Room.hostId` はスキーマにはあるが未活用（将来のため枠だけ用意）
- `participantsByRoom` は**プロセス内Map**で管理（複数インスタンス化する場合は Redis 等への外出しが必要）
- ニコニコ動画の `jsapi=1` は HTTPS オリジンでのみ動作するため、ローカル HTTP では正常動作しないことがある（[frontend.md](./frontend.md#ニコニコ動画プレイヤーの特殊事情) 参照）
