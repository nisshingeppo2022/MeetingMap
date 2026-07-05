-- P11: 週次Dreaming + _soul.md 共通参照
-- source 'system' は週次Dreaming等のシステム生成キャプチャ用
ALTER TYPE "CaptureSource" ADD VALUE IF NOT EXISTS 'system';

-- _soul.md の内容などを保持する共有設定テーブル。
-- RLSを有効にしポリシーを作らない = service_role(サーバー側)のみ読み書き可能
CREATE TABLE IF NOT EXISTS app_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
