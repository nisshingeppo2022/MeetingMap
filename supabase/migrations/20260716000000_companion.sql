-- P13: ロボホン相棒バックエンド(Companion API)。
-- device_tokens / consult_sessions は既存の Quick Capture 認証・Web版「相談」機能の
-- テーブルと同名になるため衝突する。companion_ プレフィックスの専用テーブルを新設する。

CREATE TABLE IF NOT EXISTS companion_device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  label text NOT NULL,
  allowed_modes text[] NOT NULL DEFAULT ARRAY['student'],
  failed_pin_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companion_consult_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  device_token_id uuid NOT NULL REFERENCES companion_device_tokens(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companion_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('student', 'consult')),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_companion_messages_session ON companion_messages(session_id, id);

-- RLS: service role相当(Prismaの直接DB接続。DATABASE_URLはRLSをバイパスする)のみが
-- 触る前提でポリシーは作らない。app_config / consult_sessions と同じパターン
ALTER TABLE companion_device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE companion_consult_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE companion_messages ENABLE ROW LEVEL SECURITY;

-- ロボホン由来のcaptureを既存sourceと区別するための新しいenum値
ALTER TYPE "CaptureSource" ADD VALUE IF NOT EXISTS 'robohon';

-- ロボホン関連タグの投入(HANDOFF.md記載のタグ一覧)
INSERT INTO capture_tag_defs (slug, label, sort_order, description) VALUES
  ('robohon', 'ロボホン', 80, 'ロボホン経由の入力(生徒モード・相談モード共通)'),
  ('consult', '相談(ロボホン)', 81, 'ロボホンの相談モードでの対話'),
  ('stem-club', 'STEM部', 82, 'STEM部活動(ロボホン生徒モード)'),
  ('bunkasai-metaverse', '文化祭メタバース(ロボホン)', 83, '文化祭メタバース企画。ロボホン生徒モードの話題タグ'),
  ('club-shared', '部活共有', 84, '生徒モードのロボホンに共有してよい記録。手動でこのタグを付けた記録のみ生徒モードから参照可能(オプトイン、絶対にコードでは緩和しない)')
ON CONFLICT (slug) DO NOTHING;

-- テスト用トークンの発行例(本番前に値を変えること。Supabase SQL Editorで手動実行):
-- INSERT INTO companion_device_tokens (token, label, allowed_modes) VALUES
--   ('CHANGE_ME_ROBOHON', 'ロボホン(学校・両モード。相談はPIN必須)', ARRAY['student','consult']),
--   ('CHANGE_ME_PERSONAL', '本人のiPhone/Mac(テスト・/consult統合用)', ARRAY['student','consult']);
