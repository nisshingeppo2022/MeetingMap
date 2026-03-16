# MeetingMap — Claude への引き継ぎ指示

## プロジェクト概要

営業・商談の録音・議事録を AI でマインドマップ化し、過去の商談とクロスリンク分析するアプリ。

## 技術スタック

- Next.js 14 App Router + TypeScript + Tailwind CSS
- Supabase Auth + PostgreSQL (Prisma ORM v7, @prisma/adapter-pg)
- Gemini API: v1beta, モデル `gemini-2.5-flash`（直接 REST fetch、SDK は使わない）
- React Flow v11 でマインドマップ表示
- PWA 対応

## 重要な設定（触らないこと）

### schema.prisma
`previewFeatures = ["driverAdapters"]` は必須。削除すると Vercel で `__dirname is not defined` エラーが発生する。

### next.config.mjs
`experimental.serverComponentsExternalPackages` に `pg`, `@prisma/client`, `@prisma/adapter-pg`, `prisma` が含まれていること。

### package.json
ビルドコマンドは `prisma generate && next build`（Vercel の prisma generate のため）。

### middleware.ts
`@supabase/ssr` を使った Edge Runtime 対応の認証チェック。
認証不要パス: `/auth/login`, `/auth/signup`, `/share/`

## 環境変数（.env.local）

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL        # Supabase pooler (port 6543)
DIRECT_URL          # Supabase direct (port 5432)
GEMINI_API_KEY
```

## デプロイ

- GitHub: https://github.com/nisshingeppo2022/MeetingMap
- Vercel プロジェクト名: `meetingmap`
- 本番URL: https://meetingmap-nisshingeppo2022s-projects.vercel.app/
- Framework Preset: **Next.js**（重要：Other にしない）
- Root Directory: `./`

## 主要ファイル構成

```
app/
  page.tsx                          # ホーム（ミーティング一覧）
  meetings/
    new/page.tsx                    # 新規ミーティング作成
    [id]/
      record/page.tsx               # 録音ページ（リアルタイム関連議題表示あり）
      result/page.tsx               # 結果・AI分析ページ
      recall/page.tsx               # 振り返りページ
      import/page.tsx               # 音声インポート
  map/page.tsx                      # マインドマップ全体表示（React Flow）
  contacts/page.tsx                 # 連絡先一覧
  actions/page.tsx                  # アクション一覧
  topics/page.tsx                   # トピック管理
  share/[token]/page.tsx            # 共有リンク（認証不要）
  auth/
    login/page.tsx
    signup/page.tsx
  api/
    meetings/[id]/route.ts          # ミーティング CRUD
    ai/
      analyze/route.ts              # Gemini AI 分析
      crosslinks/route.ts           # クロスリンク AI 生成
    crosslinks/route.ts             # クロスリンク CRUD
    mindmap/starred/route.ts        # 星付きノード取得
lib/
  prisma.ts                         # Prisma クライアント（@prisma/adapter-pg 使用）
  supabase-server.ts                # Supabase サーバークライアント
  supabase.ts                       # Supabase ブラウザクライアント
  gemini.ts                         # Gemini API 直接 fetch
hooks/
  useAudioRecorder.ts               # MediaRecorder フック
  useSpeechRecognition.ts           # WebSpeechRecognition フック
middleware.ts                       # 認証ミドルウェア
prisma/schema.prisma                # DB スキーマ
prisma.config.ts                    # Prisma 設定（.env.local 読み込み）
```

## 実装済み機能

1. ミーティング録音・文字起こし（WebSpeechRecognition）
2. AI マインドマップ生成（Gemini）
3. クロスリンク分析（過去ミーティングとの関連付け）
4. 録音中リアルタイム関連議題表示（星付きノードとのキーワードマッチング）
5. 連絡先管理・名刺スキャン
6. 共有リンク生成
7. PWA 対応

## 開発の経緯・解決済みの問題

### Vercel デプロイで発生した問題と解決策

| 問題 | 原因 | 解決 |
|------|------|------|
| `__dirname is not defined` | schema.prisma に driverAdapters 設定なし | previewFeatures = ["driverAdapters"] を追加 |
| `MIDDLEWARE_INVOCATION_FAILED` | middleware で pg/Prisma を間接インポート | middleware から DB 処理を完全に除去 |
| 404 NOT_FOUND（全ページ） | Vercel の Framework Preset が "Other" になっていた | "Next.js" に変更 |
| クロスリンク一覧が空 | Prisma クエリで `isAccepted: { not: false }` が NULL を除外 | `OR: [{ isAccepted: null }, { isAccepted: true }]` に変更 |

### クロスリンク分析の設計

- 星付きノード＋その全子孫ノードを候補として収集
- キーワードマッチング（ストップワード除外、トークン長3文字以上、部分マッチは4文字以上）
- フォールバック接続（キーワードなしの弱いリンク）は削除済み

## ユーザー設定

- 返答は日本語
