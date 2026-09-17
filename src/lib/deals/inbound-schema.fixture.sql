-- Test-only extension of lifecycle-schema.fixture.sql; never deployed.
ALTER TABLE accounts ADD COLUMN default_currency TEXT NOT NULL DEFAULT 'BRL';
ALTER TABLE conversations ADD COLUMN user_id UUID;
ALTER TABLE conversations ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE conversations ADD COLUMN last_message_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN last_message_text TEXT;
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations,
  sender_type TEXT NOT NULL CHECK(sender_type IN ('customer','agent','bot')),
  content_type TEXT NOT NULL DEFAULT 'text', content_text TEXT, message_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), status TEXT DEFAULT 'delivered',
  UNIQUE(conversation_id,message_id)
);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_read ON messages FOR SELECT USING (
  EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_id AND is_account_member(c.account_id)));
CREATE POLICY messages_write ON messages FOR INSERT WITH CHECK (
  EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_id AND is_account_member(c.account_id,'agent')));
GRANT ALL ON messages TO authenticated,service_role;
INSERT INTO conversations(id,account_id,contact_id,user_id) VALUES
  ('60000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002');
