-- 21G: tenant ownership is a database invariant, including service_role writes.
-- Fail on inconsistent legacy data; do not silently delete/repair customer data.
CREATE SCHEMA IF NOT EXISTS wacrm_private;
REVOKE ALL ON SCHEMA wacrm_private FROM PUBLIC, anon, authenticated;

CREATE FUNCTION wacrm_private.derive_child_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE parent_account uuid; parent_id uuid;
BEGIN
  parent_id := (to_jsonb(NEW)->>TG_ARGV[1])::uuid;
  EXECUTE format('SELECT account_id FROM public.%I WHERE id=$1', TG_ARGV[0])
    INTO parent_account USING parent_id;
  IF parent_account IS NULL THEN
    RAISE EXCEPTION 'Tenant parent not found' USING ERRCODE='23503';
  END IF;
  IF NEW.account_id IS NULL THEN NEW.account_id := parent_account; END IF;
  IF NEW.account_id <> parent_account THEN
    RAISE EXCEPTION 'Tenant parent mismatch' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION wacrm_private.derive_child_account() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('contact_tags','contacts','contact_id'),
    ('contact_custom_values','contacts','contact_id'),
    ('messages','conversations','conversation_id'),
    ('pipeline_stages','pipelines','pipeline_id'),
    ('broadcast_recipients','broadcasts','broadcast_id'),
    ('automation_steps','automations','automation_id'),
    ('message_reactions','conversations','conversation_id'),
    ('flow_nodes','flows','flow_id'),
    ('flow_run_events','flow_runs','flow_run_id')
  ) AS v(child,parent,parent_key) LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN account_id uuid',r.child);
    EXECUTE format('UPDATE public.%I c SET account_id=p.account_id FROM public.%I p WHERE c.%I=p.id',r.child,r.parent,r.parent_key);
    SET CONSTRAINTS ALL IMMEDIATE;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN account_id SET NOT NULL',r.child);
    EXECUTE format('CREATE TRIGGER derive_tenant BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION wacrm_private.derive_child_account(%L,%L)',r.child,r.parent,r.parent_key);
    SET CONSTRAINTS ALL DEFERRED;
  END LOOP;
END $$;

-- Composite keys on every resource used as a tenant-scoped parent.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts','tags','custom_fields','conversations',
    'messages','pipelines','pipeline_stages','broadcasts','automations',
    'automation_steps','automation_logs','flows','flow_nodes','flow_runs',
    'ai_knowledge_documents','profiles'] LOOP
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I(id,account_id)',t||'_id_tenant_21g',t);
  END LOOP;
END $$;

DO $$
DECLARE r record; legacy_fk text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('conversations','contact_id','contacts','CASCADE'),
    ('contact_notes','contact_id','contacts','CASCADE'),
    ('contact_tags','contact_id','contacts','CASCADE'),
    ('contact_tags','tag_id','tags','CASCADE'),
    ('contact_custom_values','contact_id','contacts','CASCADE'),
    ('contact_custom_values','custom_field_id','custom_fields','CASCADE'),
    ('messages','conversation_id','conversations','CASCADE'),
    ('messages','reply_to_message_id','messages','SET NULL'),
    ('pipeline_stages','pipeline_id','pipelines','CASCADE'),
    ('deals','pipeline_id','pipelines','CASCADE'),
    ('deals','stage_id','pipeline_stages','NO ACTION'),
    ('deals','contact_id','contacts','SET NULL'),
    ('deals','conversation_id','conversations','NO ACTION'),
    ('broadcast_recipients','broadcast_id','broadcasts','CASCADE'),
    ('broadcast_recipients','contact_id','contacts','SET NULL'),
    ('automation_steps','automation_id','automations','CASCADE'),
    ('automation_steps','parent_step_id','automation_steps','CASCADE'),
    ('automation_logs','automation_id','automations','CASCADE'),
    ('automation_logs','contact_id','contacts','SET NULL'),
    ('automation_pending_executions','automation_id','automations','CASCADE'),
    ('automation_pending_executions','contact_id','contacts','SET NULL'),
    ('automation_pending_executions','log_id','automation_logs','CASCADE'),
    ('automation_pending_executions','parent_step_id','automation_steps','SET NULL'),
    ('message_reactions','message_id','messages','CASCADE'),
    ('message_reactions','conversation_id','conversations','CASCADE'),
    ('flow_nodes','flow_id','flows','CASCADE'),
    ('flow_runs','flow_id','flows','CASCADE'),
    ('flow_runs','contact_id','contacts','SET NULL'),
    ('flow_runs','conversation_id','conversations','SET NULL'),
    ('flow_runs','last_prompt_message_id','messages','SET NULL'),
    ('flow_run_events','flow_run_id','flow_runs','CASCADE'),
    ('notifications','conversation_id','conversations','CASCADE'),
    ('notifications','contact_id','contacts','SET NULL'),
    ('ai_knowledge_chunks','document_id','ai_knowledge_documents','CASCADE'),
    ('ai_usage_log','conversation_id','conversations','SET NULL'),
    ('meta_conversion_events','stage_id','pipeline_stages','SET NULL')
  ) AS v(child,key,parent,deletion) LOOP
    -- Replace, rather than duplicate, the relation: PostgREST embeds must
    -- remain unambiguous and existing explicit FK hints must keep working.
    SELECT c.conname INTO legacy_fk FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname=r.key
      WHERE c.contype='f' AND c.conrelid=format('public.%I',r.child)::regclass
        AND c.confrelid=format('public.%I',r.parent)::regclass
        AND c.conkey=ARRAY[a.attnum] LIMIT 1;
    IF legacy_fk IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',r.child,legacy_fk);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I,account_id) REFERENCES public.%I(id,account_id) ON DELETE %s%s',
      r.child,COALESCE(legacy_fk,r.child||'_'||r.key||'_tenant_21g'),r.key,r.parent,r.deletion,
      CASE WHEN r.deletion='SET NULL' THEN format(' (%I)',r.key) ELSE '' END);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(%I,account_id)',r.child||'_'||r.key||'_tenant_idx_21g',r.child,r.key);
  END LOOP;
END $$;

CREATE FUNCTION wacrm_private.immutable_resource_account()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'Resource account cannot be reassigned' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION wacrm_private.immutable_resource_account() FROM PUBLIC,anon,authenticated;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='account_id' AND table_name<>'profiles' LOOP
    EXECUTE format('CREATE TRIGGER immutable_tenant BEFORE UPDATE OF account_id ON public.%I FOR EACH ROW EXECUTE FUNCTION wacrm_private.immutable_resource_account()',t.table_name);
  END LOOP;
END $$;

-- Mutable assignees are membership references, unlike historical audit authors.
-- A departed member must not pin their old assignments or receive new notices.
CREATE FUNCTION wacrm_private.validate_tenant_members()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target uuid;
BEGIN
  target := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
  IF target IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles p
    WHERE p.account_id=NEW.account_id AND
    CASE WHEN TG_ARGV[1]='profile' THEN p.id=target ELSE p.user_id=target END) THEN
    RAISE EXCEPTION 'Assignee/recipient is not an account member' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION wacrm_private.validate_tenant_members() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER tenant_assignee BEFORE INSERT OR UPDATE OF assigned_agent_id,account_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION wacrm_private.validate_tenant_members('assigned_agent_id','user');
CREATE TRIGGER tenant_assignee BEFORE INSERT OR UPDATE OF assigned_to,account_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION wacrm_private.validate_tenant_members('assigned_to','profile');
CREATE TRIGGER tenant_recipient BEFORE INSERT OR UPDATE OF user_id,account_id ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION wacrm_private.validate_tenant_members('user_id','user');
CREATE TRIGGER tenant_handoff BEFORE INSERT OR UPDATE OF handoff_agent_id,account_id ON public.ai_configs
  FOR EACH ROW EXECUTE FUNCTION wacrm_private.validate_tenant_members('handoff_agent_id','user');

CREATE FUNCTION wacrm_private.clear_departing_assignments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    UPDATE public.conversations SET assigned_agent_id=NULL WHERE account_id=OLD.account_id AND assigned_agent_id=OLD.user_id;
    UPDATE public.deals SET assigned_to=NULL WHERE account_id=OLD.account_id AND assigned_to=OLD.id;
    UPDATE public.ai_configs SET handoff_agent_id=NULL WHERE account_id=OLD.account_id AND handoff_agent_id=OLD.user_id;
    DELETE FROM public.member_presence WHERE account_id=OLD.account_id AND user_id=OLD.user_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION wacrm_private.clear_departing_assignments() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER departing_assignments BEFORE UPDATE OF account_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION wacrm_private.clear_departing_assignments();

DROP POLICY profiles_insert ON public.profiles;
REVOKE INSERT,DELETE ON public.profiles FROM anon,authenticated;
DROP POLICY notifications_select ON public.notifications;
DROP POLICY notifications_update ON public.notifications;
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated
  USING (user_id=(SELECT auth.uid()) AND public.is_account_member(account_id));
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated
  USING (user_id=(SELECT auth.uid()) AND public.is_account_member(account_id))
  WITH CHECK (user_id=(SELECT auth.uid()) AND public.is_account_member(account_id));

CREATE FUNCTION wacrm_private.guard_owner_pointer()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF current_user IN ('authenticated','anon') AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'Use ownership transfer RPC' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION wacrm_private.guard_owner_pointer() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER owner_pointer BEFORE UPDATE OF owner_user_id ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION wacrm_private.guard_owner_pointer();

-- Atomic default provisioning follows membership, not a browser page visit.
ALTER TABLE public.pipelines ADD COLUMN is_bootstrap boolean NOT NULL DEFAULT false;
CREATE FUNCTION wacrm_private.provision_account_defaults(p_account uuid,p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pipeline uuid;
BEGIN
  PERFORM 1 FROM public.accounts WHERE id=p_account FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.pipelines WHERE account_id=p_account) THEN RETURN; END IF;
  INSERT INTO public.pipelines(account_id,user_id,name,is_bootstrap)
    VALUES(p_account,p_user,'Sales Pipeline',true) RETURNING id INTO pipeline;
  INSERT INTO public.pipeline_stages(pipeline_id,name,color,position,meta_conversion_event)
    VALUES(pipeline,'New Lead','#6366f1',0,NULL),
    (pipeline,'Qualified','#8b5cf6',1,NULL),
    (pipeline,'Proposal Sent','#f59e0b',2,NULL),
    (pipeline,'Negotiation','#f97316',3,NULL),
    (pipeline,'Won','#22c55e',4,NULL);
  -- Existing pipeline trigger creates unmapped technical Venda perdida.
END $$;
REVOKE ALL ON FUNCTION wacrm_private.provision_account_defaults(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION wacrm_private.owner_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.account_role='owner' THEN
    PERFORM wacrm_private.provision_account_defaults(NEW.account_id,NEW.user_id);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION wacrm_private.owner_defaults() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER owner_defaults AFTER INSERT OR UPDATE OF account_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION wacrm_private.owner_defaults();

CREATE FUNCTION wacrm_private.guard_bootstrap_marker()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF current_user IN ('authenticated','anon') AND
    (TG_OP='INSERT' AND NEW.is_bootstrap OR TG_OP='UPDATE' AND NEW.is_bootstrap IS DISTINCT FROM OLD.is_bootstrap) THEN
    RAISE EXCEPTION 'Bootstrap marker is server-managed' USING ERRCODE='42501';
  END IF;
  -- A customized personal pipeline is real data, not disposable onboarding.
  IF TG_OP='UPDATE' AND NEW IS DISTINCT FROM OLD THEN NEW.is_bootstrap=false; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION wacrm_private.guard_bootstrap_marker() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER bootstrap_marker BEFORE INSERT OR UPDATE ON public.pipelines
  FOR EACH ROW EXECUTE FUNCTION wacrm_private.guard_bootstrap_marker();

CREATE FUNCTION wacrm_private.mark_customized_bootstrap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  -- Nested inserts come only from atomic defaults / technical lost-stage
  -- provisioning. Direct stage edits must prevent invitation data deletion.
  IF pg_trigger_depth()=1 THEN
    UPDATE public.pipelines SET is_bootstrap=false
      WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.pipeline_id ELSE NEW.pipeline_id END
        AND is_bootstrap;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION wacrm_private.mark_customized_bootstrap() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER customized_bootstrap AFTER INSERT OR UPDATE OR DELETE ON public.pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION wacrm_private.mark_customized_bootstrap();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE account uuid; display_name text;
BEGIN
  display_name:=COALESCE(NEW.raw_user_meta_data->>'full_name','');
  INSERT INTO public.accounts(name,owner_user_id)
    VALUES(COALESCE(NULLIF(display_name,''),NEW.email,'My account'),NEW.id) RETURNING id INTO account;
  INSERT INTO public.profiles(user_id,full_name,email,account_id,account_role)
    VALUES(NEW.id,display_name,COALESCE(NEW.email,''),account,'owner');
  RETURN NEW; -- Any failure rolls back Auth user + account + defaults together.
END $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.create_my_account(p_name text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE uid uuid:=auth.uid(); account uuid; u auth.users%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
  SELECT account_id INTO account FROM public.profiles WHERE user_id=uid FOR UPDATE;
  IF account IS NOT NULL THEN RETURN account; END IF;
  SELECT * INTO u FROM auth.users WHERE id=uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  SELECT id INTO account FROM public.accounts WHERE owner_user_id=uid FOR UPDATE;
  IF account IS NULL THEN
    INSERT INTO public.accounts(name,owner_user_id)
      VALUES(COALESCE(NULLIF(btrim(p_name),''),NULLIF(u.raw_user_meta_data->>'full_name',''),u.email,'My account'),uid)
      RETURNING id INTO account;
  END IF;
  INSERT INTO public.profiles(user_id,full_name,email,account_id,account_role)
    VALUES(uid,COALESCE(u.raw_user_meta_data->>'full_name',''),COALESCE(u.email,''),account,'owner');
  RETURN account;
END $$;
REVOKE ALL ON FUNCTION public.create_my_account(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_my_account(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE uid uuid:=auth.uid(); inv public.account_invitations%ROWTYPE;
  old_account uuid; old_owner uuid; u auth.users%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
  SELECT * INTO inv FROM public.account_invitations WHERE token_hash=p_token_hash FOR UPDATE;
  IF NOT FOUND OR inv.accepted_at IS NOT NULL OR inv.expires_at<=now() THEN
    RAISE EXCEPTION 'Invalid, expired or used invitation' USING ERRCODE='22023';
  END IF;
  IF inv.role='owner' THEN RAISE EXCEPTION 'Invalid invitation role' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.accounts WHERE id=inv.account_id FOR UPDATE;
  SELECT p.account_id,a.owner_user_id INTO old_account,old_owner
    FROM public.profiles p JOIN public.accounts a ON a.id=p.account_id
    WHERE p.user_id=uid FOR UPDATE OF p,a;
  IF old_account=inv.account_id THEN RAISE EXCEPTION 'Already a member' USING ERRCODE='23505'; END IF;
  IF old_account IS NOT NULL THEN
    IF old_owner<>uid OR EXISTS(SELECT 1 FROM public.profiles WHERE account_id=old_account AND user_id<>uid) THEN
      RAISE EXCEPTION 'Cannot abandon shared account' USING ERRCODE='23505';
    END IF;
    IF EXISTS(SELECT 1 FROM public.contacts WHERE account_id=old_account
      UNION ALL SELECT 1 FROM public.conversations WHERE account_id=old_account
      UNION ALL SELECT 1 FROM public.deals WHERE account_id=old_account
      UNION ALL SELECT 1 FROM public.broadcasts WHERE account_id=old_account
      UNION ALL SELECT 1 FROM public.automations WHERE account_id=old_account
      UNION ALL SELECT 1 FROM public.flows WHERE account_id=old_account
      UNION ALL SELECT 1 FROM public.pipelines WHERE account_id=old_account AND NOT is_bootstrap
      UNION ALL SELECT 1 FROM public.message_templates WHERE account_id=old_account
      UNION ALL SELECT 1 FROM public.tags WHERE account_id=old_account
      UNION ALL SELECT 1 FROM public.custom_fields WHERE account_id=old_account
      UNION ALL SELECT 1 FROM public.contact_notes WHERE account_id=old_account
      UNION ALL SELECT 1 FROM public.whatsapp_config WHERE account_id=old_account
      UNION ALL SELECT 1 FROM public.meta_conversion_config WHERE account_id=old_account) THEN
      RAISE EXCEPTION 'Account contains data' USING ERRCODE='23505';
    END IF;
    UPDATE public.profiles SET account_id=inv.account_id,account_role=inv.role WHERE user_id=uid AND account_id=old_account;
  ELSE
    SELECT * INTO u FROM auth.users WHERE id=uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
    INSERT INTO public.profiles(user_id,full_name,email,account_id,account_role)
      VALUES(uid,COALESCE(u.raw_user_meta_data->>'full_name',''),COALESCE(u.email,''),inv.account_id,inv.role);
  END IF;
  UPDATE public.account_invitations SET accepted_at=now(),accepted_by_user_id=uid WHERE id=inv.id;
  IF old_account IS NOT NULL THEN DELETE FROM public.accounts WHERE id=old_account; END IF;
  RETURN inv.account_id;
END $$;
REVOKE ALL ON FUNCTION public.redeem_invitation(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(text) TO authenticated;

-- Private Storage; preserve existing paths and bytes. Legacy avatars derive
-- tenant ownership from their user's current profile, not public readability.
CREATE FUNCTION public.can_access_tenant_object(bucket text,path text,write_access boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.profiles caller WHERE caller.user_id=auth.uid() AND (
      bucket IN ('chat-media','flow-media') AND
        split_part(path,'/',1)='account-'||caller.account_id::text AND
        (NOT write_access OR caller.account_role IN ('owner','admin','agent'))
      OR bucket='avatars' AND EXISTS(SELECT 1 FROM public.profiles owner
        WHERE owner.user_id::text=split_part(path,'/',1) AND owner.account_id=caller.account_id
        AND (NOT write_access OR owner.user_id=auth.uid()))))
$$;
REVOKE ALL ON FUNCTION public.can_access_tenant_object(text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_access_tenant_object(text,text,boolean) TO authenticated;
UPDATE storage.buckets SET public=false WHERE id IN ('avatars','chat-media','flow-media');
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
    AND (COALESCE(qual,'')||COALESCE(with_check,'')) ~ '(avatars|chat-media|flow-media)' LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects',p.policyname);
  END LOOP;
END $$;
CREATE POLICY tenant_object_select ON storage.objects FOR SELECT TO authenticated
  USING(public.can_access_tenant_object(bucket_id,name,false));
CREATE POLICY tenant_object_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK(public.can_access_tenant_object(bucket_id,name,true));
CREATE POLICY tenant_object_update ON storage.objects FOR UPDATE TO authenticated
  USING(public.can_access_tenant_object(bucket_id,name,true))
  WITH CHECK(public.can_access_tenant_object(bucket_id,name,true));
CREATE POLICY tenant_object_delete ON storage.objects FOR DELETE TO authenticated
  USING(public.can_access_tenant_object(bucket_id,name,true));

-- Token-free durable references, resolved through the authenticated app proxy.
UPDATE public.profiles SET avatar_url=regexp_replace(avatar_url,'^https?://[^/]+/storage/v1/object/public/(avatars/.+)$','/api/storage/\1')
  WHERE avatar_url ~ '^https?://[^/]+/storage/v1/object/public/avatars/';
UPDATE public.messages SET media_url=regexp_replace(media_url,'^https?://[^/]+/storage/v1/object/public/((chat-media|flow-media)/.+)$','/api/storage/\1')
  WHERE media_url ~ '^https?://[^/]+/storage/v1/object/public/(chat-media|flow-media)/';
