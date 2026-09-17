-- ISOLATED TEST DATABASE ONLY. No network, production credentials or real PII.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('test.uid', true), '')::uuid
$$;
CREATE TABLE auth.users(id UUID PRIMARY KEY, email TEXT, raw_user_meta_data JSONB);
CREATE TYPE account_role_enum AS ENUM ('owner','admin','agent','viewer');
CREATE TABLE accounts(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, owner_user_id UUID);
CREATE TABLE profiles(id UUID DEFAULT gen_random_uuid(), user_id UUID PRIMARY KEY,
  account_id UUID, account_role account_role_enum NOT NULL, full_name TEXT, email TEXT);
CREATE TABLE account_invitations(id UUID DEFAULT gen_random_uuid(), account_id UUID,
  role account_role_enum, token_hash TEXT UNIQUE, expires_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ, accepted_by_user_id UUID);
CREATE TABLE member_presence(user_id UUID PRIMARY KEY, account_id UUID NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('online','away')), last_seen_at TIMESTAMPTZ);
CREATE TABLE contacts(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id UUID,
  phone_normalized TEXT, name TEXT, phone TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id UUID,
  contact_id UUID, ai_reply_count INTEGER DEFAULT 0, unread_count INTEGER DEFAULT 0,
  last_message_text TEXT, last_message_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  assigned_agent_id UUID, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE webhook_endpoints(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id UUID,
  failure_count INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true);
CREATE TABLE broadcasts(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id UUID,
  user_id UUID, name TEXT, template_name TEXT, template_language TEXT, status TEXT,
  total_recipients INTEGER, sent_count INTEGER DEFAULT 0, delivered_count INTEGER DEFAULT 0,
  read_count INTEGER DEFAULT 0, replied_count INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ);
CREATE TABLE broadcast_recipients(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), broadcast_id UUID,
  contact_id UUID, status TEXT, template_params JSONB);
CREATE TABLE automations(id UUID, account_id UUID, execution_count INTEGER DEFAULT 0, last_executed_at TIMESTAMPTZ);
CREATE TABLE flows(id UUID, account_id UUID, execution_count INTEGER DEFAULT 0, last_executed_at TIMESTAMPTZ);
CREATE TABLE messages(id UUID DEFAULT gen_random_uuid(), conversation_id UUID, content_text TEXT,
  created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE deals(id UUID DEFAULT gen_random_uuid(), contact_id UUID, conversation_id UUID);
CREATE TABLE contact_notes(contact_id UUID, account_id UUID);
CREATE TABLE automation_logs(contact_id UUID);
CREATE TABLE automation_pending_executions(contact_id UUID);
CREATE TABLE contact_tags(contact_id UUID, tag_id UUID, UNIQUE(contact_id,tag_id));
CREATE TABLE contact_custom_values(contact_id UUID, custom_field_id UUID, UNIQUE(contact_id,custom_field_id));
CREATE TABLE flow_runs(contact_id UUID, conversation_id UUID, status TEXT);
CREATE TABLE message_reactions(conversation_id UUID);
CREATE TABLE notifications(account_id UUID, user_id UUID, type TEXT, conversation_id UUID,
  contact_id UUID, actor_user_id UUID, title TEXT, body TEXT);
CREATE TABLE ai_usage_log(conversation_id UUID);
CREATE TABLE pipelines(account_id UUID);
CREATE TABLE message_templates(account_id UUID);
CREATE TABLE tags(account_id UUID);
CREATE TABLE custom_fields(account_id UUID);
CREATE TABLE whatsapp_config(account_id UUID);
-- service_role has the same table privileges used by the real admin client.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_profile_read ON profiles FOR SELECT USING(user_id=auth.uid());
-- No browser write policy: authorized team changes go through guarded RPCs.
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_presence ENABLE ROW LEVEL SECURITY;
