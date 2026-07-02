-- Enable Row Level Security on all application tables.
-- Prisma connects via the `postgres` role, which has BYPASSRLS, so these
-- policies only restrict access via PostgREST (anon/authenticated roles
-- using the public anon key), not the app's own server-side queries.

-- contacts
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts_own" ON contacts FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

-- meetings
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meetings_own" ON meetings FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

-- topics
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "topics_own" ON topics FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

-- cross_links
ALTER TABLE cross_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cross_links_own" ON cross_links FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

-- share_links (owner-only; public token access is handled server-side via
-- Prisma in app/share/[token]/page.tsx, which bypasses RLS entirely)
ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "share_links_own" ON share_links FOR ALL TO authenticated
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

-- meeting_contacts (junction table; ownership derived from parent meeting)
ALTER TABLE meeting_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meeting_contacts_own" ON meeting_contacts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM meetings m WHERE m.id = meeting_contacts.meeting_id AND m.user_id = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM meetings m WHERE m.id = meeting_contacts.meeting_id AND m.user_id = auth.uid()::text));

-- mindmap_nodes (ownership derived from parent meeting)
ALTER TABLE mindmap_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mindmap_nodes_own" ON mindmap_nodes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM meetings m WHERE m.id = mindmap_nodes.meeting_id AND m.user_id = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM meetings m WHERE m.id = mindmap_nodes.meeting_id AND m.user_id = auth.uid()::text));

-- topic_items (ownership derived from parent topic)
ALTER TABLE topic_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "topic_items_own" ON topic_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM topics t WHERE t.id = topic_items.topic_id AND t.user_id = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM topics t WHERE t.id = topic_items.topic_id AND t.user_id = auth.uid()::text));

-- topic_item_meetings (junction table; ownership derived from parent meeting)
ALTER TABLE topic_item_meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "topic_item_meetings_own" ON topic_item_meetings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM meetings m WHERE m.id = topic_item_meetings.meeting_id AND m.user_id = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM meetings m WHERE m.id = topic_item_meetings.meeting_id AND m.user_id = auth.uid()::text));
