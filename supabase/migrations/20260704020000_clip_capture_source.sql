-- P12: クリップ機能(他者の言葉の収集)。captures に url/why/summary/use_for/keywords を追加し、
-- capture_source enum に 'clip' を追加、capture_tag_defs に 'clip' タグを投入する。

ALTER TABLE captures ADD COLUMN IF NOT EXISTS url text;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS why text;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS use_for text[] NOT NULL DEFAULT '{}';
ALTER TABLE captures ADD COLUMN IF NOT EXISTS keywords text[] NOT NULL DEFAULT '{}';

ALTER TYPE "CaptureSource" ADD VALUE IF NOT EXISTS 'clip';

INSERT INTO capture_tag_defs (slug, label, sort_order, description) VALUES
  ('clip', 'クリップ', 70,
   '他者の文章・記事・引用の保存。本文が一人称の呟きではなく引用・転載である場合はこのタグ')
ON CONFLICT (slug) DO NOTHING;
