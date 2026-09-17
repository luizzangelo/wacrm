-- Isolated PostgreSQL test fixture, never deployed. Models existing 001/017/021.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE FUNCTION public.is_account_member(account UUID, minimum TEXT DEFAULT 'viewer')
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT account::text = current_setting('test.account', true) AND
    CASE current_setting('test.member_role', true)
      WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'agent' THEN 2 ELSE 1 END >=
    CASE minimum WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'agent' THEN 2 ELSE 1 END
$$;
CREATE FUNCTION public.update_updated_at_column() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;
CREATE TABLE public.accounts (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id UUID NOT NULL REFERENCES accounts,
  name TEXT, phone TEXT, email TEXT
);
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id UUID NOT NULL REFERENCES accounts,
  contact_id UUID REFERENCES contacts ON DELETE SET NULL
);
CREATE TABLE public.whatsapp_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id UUID NOT NULL REFERENCES accounts
);
CREATE TABLE public.pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id UUID NOT NULL REFERENCES accounts,
  user_id UUID NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE public.pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pipeline_id UUID NOT NULL REFERENCES pipelines ON DELETE CASCADE,
  name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE public.deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id UUID NOT NULL REFERENCES accounts,
  user_id UUID NOT NULL, pipeline_id UUID NOT NULL REFERENCES pipelines ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES pipeline_stages, contact_id UUID REFERENCES contacts ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations ON DELETE SET NULL, title TEXT NOT NULL,
  value NUMERIC(12,2) NOT NULL DEFAULT 0, currency TEXT DEFAULT 'BRL', status TEXT DEFAULT 'open',
  assigned_to UUID, notes TEXT, expected_close_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER deals_updated BEFORE UPDATE ON deals FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY pipelines_read ON pipelines FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pipelines_write ON pipelines FOR ALL USING (is_account_member(account_id,'admin'))
  WITH CHECK (is_account_member(account_id,'admin'));
CREATE POLICY stages_read ON pipeline_stages FOR SELECT USING (
  EXISTS (SELECT 1 FROM pipelines p WHERE p.id=pipeline_id AND is_account_member(p.account_id)));
CREATE POLICY stages_write ON pipeline_stages FOR ALL USING (
  EXISTS (SELECT 1 FROM pipelines p WHERE p.id=pipeline_id AND is_account_member(p.account_id,'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM pipelines p WHERE p.id=pipeline_id AND is_account_member(p.account_id,'admin')));
CREATE POLICY deals_read ON deals FOR SELECT USING (is_account_member(account_id));
CREATE POLICY deals_write ON deals FOR ALL USING (is_account_member(account_id,'agent'))
  WITH CHECK (is_account_member(account_id,'agent'));
CREATE POLICY contacts_read ON contacts FOR SELECT USING (is_account_member(account_id));
CREATE POLICY conversations_read ON conversations FOR SELECT USING (is_account_member(account_id));
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;

INSERT INTO accounts(id) VALUES ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
INSERT INTO contacts(id,account_id,name) VALUES
  ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Current contact'),
  ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','Other tenant');
INSERT INTO pipelines(id,account_id,user_id,name) VALUES
  ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Existing'),
  ('20000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','Existing lost name');
INSERT INTO pipeline_stages(id,pipeline_id,name,position) VALUES
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Initial',0),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Lead',1),
  ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','Qualified',2),
  ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','Purchase',3),
  ('30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000002','Initial',0),
  ('30000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000002','Venda perdida',1);
