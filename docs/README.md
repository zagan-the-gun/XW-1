# ドキュメント一覧

Dead Beef Saloon（`0xDEADBEEF`）の設計ドキュメント集。変更が発生したら各ドキュメントも更新する。

| ドキュメント | 役割 | 主な読者 |
|---|---|---|
| [architecture.md](./architecture.md) | システム全体像・コンポーネント関係・主要ユースケース | 設計把握したい人 / AI エージェント |
| [infrastructure.md](./infrastructure.md) | Docker 構成・WSL2 + V6プラス のハマりどころ・デプロイ | 環境構築する人 |
| [backend.md](./backend.md) | REST API / Prisma スキーマ / Socket.io ハンドラ | サーバー側を実装する人 |
| [frontend.md](./frontend.md) | App Router 構成・主要コンポーネント・状態管理・プラットフォーム固有の注意 | フロント側を実装する人 |

## ドキュメント運用ルール

- **コードが真**: 具体的なフィールド名やエンドポイント定義はコードを参照する。ドキュメントはソース情報を重複させすぎず、意図・関係・全体像を書く
- **変更したら更新**: 機能追加・スキーマ変更・新エンドポイント追加時は該当ドキュメントも同じコミット／PRで更新する
- **Mermaid で図示**: 構成図・シーケンスは Mermaid で書く（GitHub 上でレンダリングされる）
- **ADR**: 現時点では採用せず（公開リポジトリのため）。将来的に意思決定ログを残したい場合は `docs/adr/` を切る

## AI エージェントが参照する順序

Cursor / Copilot 等のエージェントに作業を依頼する場合、以下の順で読ませると文脈が取りやすい：

1. ルート `README.md`（プロジェクト概要・起動方法）
2. `docs/architecture.md`（全体像）
3. タスクに応じて `docs/backend.md` / `docs/frontend.md` / `docs/infrastructure.md`
4. 該当ソース（`src/...`）

ルート `AGENTS.md` にも同じ指針を書いてある。
