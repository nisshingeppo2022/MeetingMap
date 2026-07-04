-- 相談セッションにObsidian送信の記録を追加
-- sent_to_obsidian_at: 一覧に🗂️マークを出すため
-- saved_message_count: 再送信時に前回以降の差分だけを抽出するため
ALTER TABLE consult_sessions ADD COLUMN IF NOT EXISTS sent_to_obsidian_at timestamp(3);
ALTER TABLE consult_sessions ADD COLUMN IF NOT EXISTS saved_message_count integer NOT NULL DEFAULT 0;
