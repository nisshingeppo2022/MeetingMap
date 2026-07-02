-- Enable RLS on the new meeting_topics junction table (tag infrastructure Step 1).
-- Same pattern as the other junction tables: ownership derived from the parent meeting.
ALTER TABLE meeting_topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meeting_topics_own" ON meeting_topics FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM meetings m WHERE m.id = meeting_topics.meeting_id AND m.user_id = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM meetings m WHERE m.id = meeting_topics.meeting_id AND m.user_id = auth.uid()::text));
