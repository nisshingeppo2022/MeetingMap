-- P9: プロジェクトレイヤー。capture_tag_defs に is_project 列を追加し、
-- 最初のプロジェクトタグ「文化祭メタバース」を投入する。

ALTER TABLE capture_tag_defs ADD COLUMN IF NOT EXISTS is_project boolean NOT NULL DEFAULT false;

INSERT INTO capture_tag_defs (slug, label, sort_order, is_project, description) VALUES
  ('metaverse-festival', '文化祭メタバース', 60, true,
   '文化祭でのメタバース企画。VTuberとの打ち合わせ、STEM部生徒のアイデア、企画書・スケジュール・ToDoに関する内容。発話が「文化祭、」で始まる場合は高確信度でこのタグを付与すること')
ON CONFLICT (slug) DO NOTHING;
