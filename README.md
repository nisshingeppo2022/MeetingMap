# MeetingMap

営業・商談の録音・議事録を AI でマインドマップ化し、過去の商談とクロスリンク分析するアプリ。

## 本番URL

https://meetingmap-nisshingeppo2022s-projects.vercel.app/

## 技術スタック

| カテゴリ | 技術 |
|----------|------|
| フレームワーク | Next.js 14 (App Router) + TypeScript |
| スタイリング | Tailwind CSS |
| 認証 | Supabase Auth (@supabase/ssr) |
| データベース | Supabase PostgreSQL + Prisma ORM v7 |
| DB接続 | @prisma/adapter-pg（driverAdapters有効） |
| AI | Gemini API v1beta (gemini-2.5-flash) — 直接REST fetch |
| マップ表示 | React Flow v11 |
| デプロイ | Vercel (Hobby plan) |

## 主な機能

- ミーティング録音（WebSpeechRecognition + MediaRecorder）
- AI によるマインドマップ自動生成（Gemini）
- クロスリンク分析（過去ミーティングとのキーワードマッチング）
- 録音中のリアルタイム関連議題表示（星付きノードとのキーワードマッチング）
- 連絡先管理
- 共有リンク生成（認証不要で閲覧可能）
- PWA 対応（iPhone ホーム画面インストール可能）

## ローカル開発

### 必要な環境変数（.env.local）

```
NEXT_PUBLIC_SUPABASE_URL=https://wyboikbopcplykrxnnzu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
DATABASE_URL=postgresql://postgres.wyboikbopcplykrxnnzu:...@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres
DIRECT_URL=postgresql://postgres:...@db.wyboikbopcplykrxnnzu.supabase.co:5432/postgres
GEMINI_API_KEY=...
```

### 起動

```bash
npm install
npx prisma generate
npm run dev
```

### DB スキーマ確認

```bash
npx prisma studio
```

## デプロイ（Vercel）

- GitHub リポジトリ: https://github.com/nisshingeppo2022/MeetingMap
- Vercel プロジェクト: meetingmap
- Framework Preset: **Next.js**（Otherにしないこと）
- Root Directory: `./`
- ビルドコマンド: `prisma generate && next build`（package.json に設定済み）

### Vercel 環境変数（全6件必須）

上記 `.env.local` の6変数を全て設定すること。

## 重要な実装メモ

### Prisma + Vercel の設定

`schema.prisma` に `previewFeatures = ["driverAdapters"]` が必須。
これがないと Vercel で `__dirname is not defined` エラーが発生する。

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}
```

`next.config.mjs` にも外部パッケージ設定が必要：

```js
experimental: {
  serverComponentsExternalPackages: ["pg", "@prisma/client", "@prisma/adapter-pg", "prisma"],
}
```

### 認証（middleware）

`middleware.ts` で `@supabase/ssr` を使って Edge Runtime で認証チェック。
認証不要パス: `/auth/login`, `/auth/signup`, `/share/`

### クロスリンク分析

- `app/api/ai/crosslinks/route.ts` — AI によるクロスリンク生成
- 星付きノード＋その子孫ノードを候補として収集
- キーワードマッチング（ストップワード除外、3文字以上）
- フォールバック（キーワードなし接続）は削除済み

### 録音中のリアルタイム関連議題

- `app/api/mindmap/starred/route.ts` — 星付きノード取得API
- `app/meetings/[id]/record/page.tsx` — 2秒デバウンスでキーワードマッチング

### Gemini API

SDK は使わず直接 REST fetch で呼び出し。
モデル: `gemini-2.5-flash`（`/v1beta/` エンドポイント）
