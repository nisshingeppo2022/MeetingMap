-- Quick Capture system (P1): captures / capture_tag_defs / device_tokens.
-- Same pattern as prior RLS migrations: user_id is text (Supabase auth
-- user.id string), so auth.uid() is cast to text for comparison.

ALTER TABLE captures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "captures_own" ON captures FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "device_tokens_own" ON device_tokens FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

-- capture_tag_defs is a shared, user-agnostic master list. Any authenticated
-- user may read it; only service_role (i.e. the app's own migrations) writes
-- to it, since there is no tag-management UI yet.
ALTER TABLE capture_tag_defs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "capture_tag_defs_read" ON capture_tag_defs FOR SELECT TO authenticated
  USING (true);

CREATE INDEX idx_captures_tags ON captures USING gin (tags);

INSERT INTO capture_tag_defs (slug, label, description, sort_order) VALUES
  ('retrospective', '振り返り', '私的な本音・感情・迷いのマーカー', 10),
  ('dx-highschool', 'DX高校事業', 'DXハイスクール事業の補助金・見積・提出書類・事務手続きに関する内容', 20),
  ('equipment', '備品', '部活動・授業で使う備品の購入検討に関する内容', 40),
  ('publish', 'ブログ/SNS', '学校HPブログやSNS発信のネタになりそうな内容', 50),
  ('inbox', 'その他', 'どれにも明確に当てはまらない内容', 90)
ON CONFLICT (slug) DO NOTHING;
