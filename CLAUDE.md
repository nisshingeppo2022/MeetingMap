# MeetingMap — Claude への引き継ぎ指示

## プロジェクト概要

営業・商談の録音・議事録を AI でマインドマップ化し、過去の商談とクロスリンク分析するアプリ。

## 技術スタック

- Next.js 14 App Router + TypeScript + Tailwind CSS
- Supabase Auth + PostgreSQL (Prisma ORM v7, @prisma/adapter-pg)
- Gemini API: v1beta, モデル `gemini-2.5-flash`（直接 REST fetch、SDK は使わない）
- React Flow v11 でマインドマップ表示（`app/map/page.tsx`）
- PWA 対応
- ディレクトリは App Router の標準構成。共通ロジックは `lib/`（prisma.ts / supabase*.ts / gemini.ts）、
  録音系フックは `hooks/`

## 重要な設定（触らないこと）

### schema.prisma
`previewFeatures = ["driverAdapters"]` は必須。削除すると Vercel で `__dirname is not defined` エラーが発生する。

### next.config.mjs
`experimental.serverComponentsExternalPackages` に `pg`, `@prisma/client`, `@prisma/adapter-pg`, `prisma` が含まれていること。

### package.json
ビルドコマンドは `prisma generate && next build`（Vercel の prisma generate のため）。

### middleware.ts
`@supabase/ssr` を使った Edge Runtime 対応の認証チェック。DB/Prisma のインポート禁止。
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
- Vercel プロジェクト名: `meetingmap`（`meeting-map` は非推奨・使わない）
- 本番URL: https://meetingmap-nisshingeppo2022s-projects.vercel.app/
- Framework Preset: **Next.js**（重要：Other にしない）／ Root Directory: `./`

## 過去のトラブルと設計メモ

Vercel デプロイ問題の履歴・クロスリンク分析の設計は [docs/troubleshooting.md](docs/troubleshooting.md) を参照。
