# MeetingMap トラブルシューティング・設計メモ

CLAUDE.md から移設した開発履歴。新しい問題が解決したらここに追記する。

## Vercel デプロイで発生した問題と解決策

| 問題 | 原因 | 解決 |
|------|------|------|
| `__dirname is not defined` | schema.prisma に driverAdapters 設定なし | previewFeatures = ["driverAdapters"] を追加 |
| `MIDDLEWARE_INVOCATION_FAILED` | middleware で pg/Prisma を間接インポート | middleware から DB 処理を完全に除去 |
| 404 NOT_FOUND（全ページ） | Vercel の Framework Preset が "Other" になっていた | "Next.js" に変更 |
| クロスリンク一覧が空 | Prisma クエリで `isAccepted: { not: false }` が NULL を除外 | `OR: [{ isAccepted: null }, { isAccepted: true }]` に変更 |

## クロスリンク分析の設計

- 星付きノード＋その全子孫ノードを候補として収集
- キーワードマッチング（ストップワード除外、トークン長3文字以上、部分マッチは4文字以上）
- フォールバック接続（キーワードなしの弱いリンク）は削除済み
