-- 相談履歴の削除をObsidianまで連動させるための列
-- consult_session_id: 相談由来captureの元セッション(履歴削除時に対象を特定する)
-- deleted_at: 削除予約マーク。次回のObsidian同期でファイル削除→行の完全削除が行われる
ALTER TABLE captures ADD COLUMN IF NOT EXISTS consult_session_id text;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS deleted_at timestamp(3);
