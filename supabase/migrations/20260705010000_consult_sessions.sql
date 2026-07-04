-- P10拡張: 相談セッション(チャット履歴)の保存
CREATE TABLE IF NOT EXISTS consult_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  title text NOT NULL,
  mode text NOT NULL DEFAULT 'recent',
  tag_slug text,
  messages jsonb NOT NULL DEFAULT '[]',
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_consult_sessions_user_updated
  ON consult_sessions (user_id, updated_at DESC);

ALTER TABLE consult_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consult_sessions_own" ON consult_sessions
  FOR ALL TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);
