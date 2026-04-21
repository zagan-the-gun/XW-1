# Infrastructure

> Docker / WSL2 / ネットワーク周り。環境構築や本番デプロイ時に参照する。
> アプリケーション構造は [architecture.md](./architecture.md) を参照。

## 1. コンテナ構成

`docker-compose.yml` で 2 サービスを定義：

| サービス | イメージ | 役割 | 公開ポート |
|---|---|---|---|
| `app` | `Dockerfile` (`target: dev`) | Next.js + Socket.io (`server.ts` 経由) | `3000` → `3000` |
| `db` | `postgres:16-alpine` | PostgreSQL 16 | 非公開（同ネットワーク内で `db:5432`） |

- `app` は `db` のヘルスチェック完了を待ってから起動（`depends_on.condition: service_healthy`）
- ホスト側のソース（`src/`, `prisma/`, `server.ts` 等）を bind mount しているので、**エディタで編集→ `tsx` が watch で即リロード**
- `.next` はボリューム (`nextcache`) 経由。ホスト側に漏らさず、コンテナ内で完結させる

### Dockerfile のステージ

```
base  → deps  → dev     (開発: tsx watch)
              → builder → runner  (本番: next build 済み)
```

- 開発は `target: dev` で起動（`docker-compose.yml` 指定済み）
- 本番ビルドは `docker build --target runner -t app .` で作る

## 2. 起動・運用コマンド

初回：

```bash
cp .env.example .env
docker compose up --build
# 別ターミナルで
docker compose exec app npx prisma migrate dev --name init
```

2 回目以降：

```bash
docker compose up           # 起動
docker compose down         # 停止
docker compose down -v      # DBごと消す
```

マイグレーション系：

```bash
docker compose exec app npx prisma migrate dev --name <change>   # 新しい変更
docker compose exec app npx prisma migrate deploy                 # 本番適用
docker compose exec app npx prisma studio                         # GUI
```

## 3. 環境変数

`.env.example` を元に `.env` を作成する。主なもの：

| 変数 | 用途 | 例 |
|---|---|---|
| `POSTGRES_USER` / `PASSWORD` / `DB` | PostgreSQL の初期化 | `jukebox` |
| `DATABASE_URL` | Prisma が使うDB接続URL。docker-compose 内では `db` ホスト名で自動注入される | `postgresql://jukebox:jukebox@db:5432/jukebox?schema=public` |
| `NEXT_PUBLIC_APP_URL` | クライアント側で使う自分のURL | `http://127.0.0.1:3000`（Windows）/ `http://localhost:3000`（mac/Linux） |
| `HOST` | `server.ts` のバインドアドレス。未指定なら `0.0.0.0` | 指定不要 |

> ⚠️ `HOSTNAME` ではなく `HOST` を使う。Linux コンテナは起動時に `HOSTNAME` をコンテナID（例: `3db8130efd65`）で自動設定するため、これをバインドアドレスに使うと外部からアクセスできなくなる。

## 4. DB にホストから繋ぎたい場合（Prisma Studio 等）

デフォルトでは `db` ポートを外部に公開していない。必要なら `docker-compose.yml` に：

```yaml
services:
  db:
    ports:
      - "5433:5432"
```

を追加し、`.env` で上書き：

```
DATABASE_URL=postgresql://jukebox:jukebox@localhost:5433/jukebox?schema=public
```

## 5. Windows 11 + WSL2 環境での注意点

### 5.1 構成図

```mermaid
flowchart TD
    Internet([Internet])
    Router["ルーター<br/>V6プラス / MAP-E<br/>IPv4 over IPv6 トンネル"]
    Win["Windows 11<br/>Wi-Fi: MTU 1420<br/>vEthernet (WSL): MTU 1420"]
    Ubuntu["WSL2: Ubuntu (開発)<br/>eth0: MTU 1420<br/>git clone / コード編集"]
    DD["WSL2: docker-desktop<br/>(Docker Daemon)<br/>eth0: MTU 1420<br/>default route: advmss 1380"]
    App["app コンテナ<br/>Next.js + Socket.io<br/>server.ts → 0.0.0.0:3000"]
    DB["db コンテナ<br/>PostgreSQL 16 :5432"]
    Browser["ブラウザ<br/>http://127.0.0.1:3000"]

    Internet <-->|IPv6| Router
    Router <-->|Ethernet/Wi-Fi| Win
    Win <-->|Hyper-V vSwitch| Ubuntu
    Win <-->|Hyper-V vSwitch| DD
    Ubuntu -. docker CLI .-> DD
    DD --> App
    DD --> DB
    App <-->|internal network| DB
    Browser -->|IPv4 port forward| App
```

### 5.2 コードは WSL ext4 側に置く

`git clone` は **WSL の `~/` 配下**（例: `~/dev/XW-1`）で実行する。**`/mnt/c/...` 配下は NG**。

- Windows ↔ WSL 間は 9P プロトコル経由で極端に遅い
- `node_modules`（数万ファイル）やホットリロードが実用にならないレベルで重くなる
- エディタは VS Code / Cursor の **Remote - WSL** 拡張でWSL内のフォルダを開けば、見た目はWindowsネイティブと変わらない

### 5.3 V6プラス環境での MTU 調整

V6プラスは IPv4 パケットを IPv6 でカプセル化（MAP-E）するため、経路上の実効 MTU が 1500 より小さい（約 1460、安全マージンで **1420 推奨**）。MTU が不適合だと TLS ハンドシェイクで大きな証明書パケットが届かず、以下の症状が出る：

- `docker pull` 時に `net/http: TLS handshake timeout`
- `curl https://...` がハンドシェイク中に固まる
- ブラウザの HTTPS 通信が不安定

#### 設定箇所と方法

| 箇所 | 設定値 | コマンド例 |
|---|---|---|
| ルーター | 1500（下げない） | ルーター管理画面。MSS Clamping が効いていることが望ましい |
| Windows Wi-Fi / 有線 NIC | 1420 | `netsh interface ipv4 set subinterface "Wi-Fi" mtu=1420 store=persistent` |
| Windows `vEthernet (WSL)` | 1420 | `netsh interface ipv4 set subinterface "vEthernet (WSL (Hyper-V firewall))" mtu=1420 store=persistent` |
| WSL2 Ubuntu `eth0` | 1420 | `sudo ip link set dev eth0 mtu 1420`（恒久化は `/etc/wsl.conf` の `[boot] command` 参照） |
| `docker-desktop` distro `eth0` | 1420 | PowerShell: `wsl -d docker-desktop -u root -- ip link set dev eth0 mtu 1420` |
| `docker-desktop` デフォルトルート | `advmss 1380` | PowerShell: `wsl -d docker-desktop -u root -- ip route change default via <GW> dev eth0 advmss 1380` |

> ⚠️ **ルーターとクライアントの両方で MTU を下げると二重に削られて逆に通信不良になる**。
> 原則「ルーター 1500 / クライアント 1420」か「ルーター 1420 & MSS Clamping ON / クライアント 1500」のどちらか一方に統一する。

`docker-desktop` distro の設定は再起動のたびにリセットされるため、恒久化には Docker Desktop 起動後に実行される PowerShell スクリプトを用意する：

```powershell
# docker-start.ps1 （例）
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
while ((docker info 2>$null; $LASTEXITCODE) -ne 0) { Start-Sleep -Seconds 2 }

$gw = (wsl -d docker-desktop -u root -- sh -c "ip route | awk '/^default/{print `$3; exit}'").Trim()
wsl -d docker-desktop -u root -- ip link set dev eth0 mtu 1420
wsl -d docker-desktop -u root -- ip route change default via $gw dev eth0 advmss 1380
wsl -d docker-desktop -u root -- sh -c "echo 1 > /proc/sys/net/ipv4/tcp_mtu_probing"
```

#### 切り分け手順

1. WSL Ubuntu 内で `curl -v -4 --max-time 15 https://registry-1.docker.io/v2/` → TLS 成功すれば WSL の経路はOK
2. 失敗する場合は `sudo ip link set dev eth0 mtu 1420` してから再試行
3. WSL で通るのに `docker pull` だけ失敗する → docker-desktop distro のMTU / advmss 問題
4. それでも駄目なら `wsl -d docker-desktop -u root -- ip route` して `advmss 1380` を追加

### 5.4 ブラウザからは `127.0.0.1` を使う

```
http://127.0.0.1:3000/   ← OK
http://localhost:3000/   ← Empty reply になることがある
```

原因：

- Windows 11 は `localhost` を **IPv6 (`::1`) に優先解決**する
- Docker Desktop の port forwarder は **IPv4 経路**でのみコンテナに転送する
- `::1:3000` は Listen しているプロキシには届くが、応答されず切断される

`.env` の `NEXT_PUBLIC_APP_URL` もブラウザで使うため、Windows 環境では `http://127.0.0.1:3000` に揃えると共有URLでハマらない。

### 5.5 `HOSTNAME` 環境変数の罠

Linux コンテナは起動時に `HOSTNAME` 環境変数をコンテナID（例: `3db8130efd65`）で自動設定する。`server.ts` で安直に `process.env.HOSTNAME` を参照すると `httpServer.listen(port, "3db8130efd65")` となり、ポートマッピング経由の接続が届かない。本プロジェクトでは `HOST` を使う：

```ts
// server.ts
const hostname = process.env.HOST || "0.0.0.0";
```

## 6. デプロイ（未実装・方針メモ）

本番デプロイは未着手。将来の候補：

- **シングルVPS**: `docker compose -f docker-compose.prod.yml up -d` で `runner` ステージを起動。Caddy / nginx でHTTPS 終端
- **Fly.io / Railway**: `Dockerfile` の `runner` ステージをそのまま利用。外部Postgresに接続
- **複数インスタンス化する場合**: Socket.io は Redis Adapter を入れ、`socket-handler.ts` の `participantsByRoom` も Redis に外出しする必要あり（現状はプロセス内Map）

SSL は必要（ニコニコ動画の `jsapi=1` が HTTPS オリジンでないと 403 になるため）。
