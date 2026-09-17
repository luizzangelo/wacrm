-- Hardening only: no data maintenance, event replay or migration-history repair.
-- Internal callers use supabaseAdmin/service_role; owners retain maintenance access.
-- pg_temp is explicitly LAST to prevent temporary relation/type shadowing.
-- public is non-writable by browser roles (asserted below).
DO $hardening$
DECLARE signature TEXT;
BEGIN
  IF has_schema_privilege('anon', 'public', 'CREATE')
     OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'public must not be writable by browser roles';
  END IF;
  FOREACH signature IN ARRAY ARRAY[
    'public._bcast_bump(uuid,text,integer)',
    'public.broadcast_recipient_aggregate_trigger()',
    'public.recompute_broadcast_counts(uuid)',
    'public.increment_flow_execution_count(uuid)',
    'public.claim_ai_reply_slot(uuid,integer)',
    'public.increment_automation_execution_count(uuid)',
    'public.is_account_member(uuid,public.account_role_enum)',
    'public.handle_new_user()',
    'public.set_member_role(uuid,public.account_role_enum)',
    'public.remove_account_member(uuid)',
    'public.transfer_account_ownership(uuid)',
    'public.peek_invitation(text)',
    'public.redeem_invitation(text)',
    'public.merge_duplicate_contacts()',
    'public.touch_presence(text)',
    'public.notify_conversation_assigned()',
    'public.record_webhook_failure(uuid,integer)',
    'public.merge_duplicate_conversations()',
    'public.bump_conversation_on_inbound(uuid,text)',
    'public.create_broadcast_with_recipients(uuid,uuid,text,text,text,integer,uuid[],jsonb[])'
  ] LOOP
    -- Exact reviewed allowlist; missing signatures abort the migration.
    EXECUTE format('ALTER FUNCTION %s SET search_path TO pg_catalog, public, pg_temp', signature::regprocedure);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', signature::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', signature::regprocedure);
  END LOOP;
END;
$hardening$;

-- No elevated owner privileges are necessary for these backend-only helpers.
ALTER FUNCTION public.merge_duplicate_contacts() SECURITY INVOKER;
ALTER FUNCTION public.merge_duplicate_conversations() SECURITY INVOKER;
ALTER FUNCTION public.claim_ai_reply_slot(uuid,integer) SECURITY INVOKER;
ALTER FUNCTION public.record_webhook_failure(uuid,integer) SECURITY INVOKER;
ALTER FUNCTION public.recompute_broadcast_counts(uuid) SECURITY INVOKER;
ALTER FUNCTION public._bcast_bump(uuid,text,integer) SECURITY INVOKER;

-- Non-elevating, pure/trigger helpers flagged by the security advisor.
-- Preserve their invoker behavior while removing caller-controlled resolution.
ALTER FUNCTION public._bcast_cols_for_status(text) SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.update_updated_at_column() SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.update_ai_configs_updated_at() SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.update_ai_knowledge_documents_updated_at() SET search_path TO pg_catalog, public, pg_temp;

-- Preserve authenticated, explicitly auth.uid()/account-scoped user RPCs.
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid,public.account_role_enum) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_account_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_presence(text) TO authenticated;

-- Deliberate public read-only exceptions: RLS membership boolean (anonymous
-- caller returns false) and possession-based, unexpired invitation preview.
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid,public.account_role_enum) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.peek_invitation(text) TO anon, authenticated;

-- Preserve invitation redemption while enforcing its documented tenant guard.
CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  -- Serialize joins against membership/ownership checks in the target account.
  PERFORM 1 FROM accounts WHERE id = v_inv.account_id FOR UPDATE;

  -- Caller's current account + its owner.
  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    -- Defensive — every authenticated user has a profile post-017.
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  -- Edge case: the inviter sent themselves a link, or the
  -- caller is somehow already in the inviter's account.
  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  -- Safety: the caller must be the SOLE OWNER of their current
  -- account (i.e. their fresh personal account from signup or a
  -- prior removal). Any other state means they're either:
  --   - a member of another shared account (joining a second
  --     would silently orphan their access to the first), or
  --   - the owner of an account with teammates (they'd abandon
  --     their team to join the inviter's).
  -- Either way, the safe answer is "make a different login".
  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Enforce the documented sole-member requirement, not only ownership.
  -- Otherwise an owner of an empty account could strand its teammates.
  IF EXISTS (SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id AND user_id <> v_caller_id) THEN
    RAISE EXCEPTION 'Your account has other members' USING ERRCODE = '23505';
  END IF;

  -- Belt: even if they own their account, refuse if it has any
  -- domain data — joining would orphan their contacts, deals,
  -- broadcasts, automations, flows, templates, etc.
  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Move the profile first so the cascade-on-delete of the old
  -- account doesn't try to nuke this user's profile too.
  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  -- Clean up the orphan personal account. Empty by the checks
  -- above, so this is purely housekeeping — no cascades fire
  -- because no other rows reference it.
  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$function$;

-- Keep trigger behavior; database warnings must not include untrusted SQLERRM.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile; SQLSTATE=%', SQLSTATE;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_conversation_assigned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Skip self-assignment — nothing to notify the agent about.
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    NEW.assigned_agent_id,
    'conversation_assigned',
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    'New conversation assigned',
    COALESCE(v_actor_name, 'Someone') || ' assigned you a conversation with '
      || COALESCE(v_contact_name, 'a contact')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the assignment itself.
  RAISE WARNING 'Failed to create assignment notification; SQLSTATE=%', SQLSTATE;
  RETURN NEW;
END;
$function$;

-- Preserve user RPC behavior; serialize membership checks with their writes.
CREATE OR REPLACE FUNCTION public.set_member_role(p_user_id uuid, p_new_role account_role_enum)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  -- Caller must be authenticated.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Resolve caller's account + role.
  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- Caller must be admin+.
  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  -- Can't change own role via this endpoint.
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve target.
  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  -- Target must be in caller's account.
  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- Owner role changes go through transfer_account_ownership.
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to demote an owner'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to owner'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET account_role = p_new_role
  WHERE user_id = p_user_id AND account_id = v_caller_account_id;
END;
$function$
;

-- Preserve user RPC behavior; serialize membership checks with their writes.
CREATE OR REPLACE FUNCTION public.remove_account_member(p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
  v_target_name TEXT;
  v_target_email TEXT;
  v_new_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role, full_name, email
  INTO v_target_account_id, v_target_role, v_target_name, v_target_email
  FROM profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  -- Spin up a fresh personal account for the removed user. Mirror
  -- of handle_new_user's logic — keep them whole, just relocated.
  INSERT INTO accounts (name, owner_user_id)
  VALUES (
    COALESCE(NULLIF(v_target_name, ''), v_target_email, 'My account'),
    p_user_id
  )
  RETURNING id INTO v_new_account_id;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner'
  WHERE user_id = p_user_id AND account_id = v_caller_account_id;

  RETURN v_new_account_id;
END;
$function$
;

-- Preserve user RPC behavior; serialize membership checks with their writes.
CREATE OR REPLACE FUNCTION public.transfer_account_ownership(p_new_owner_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the account owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_owner_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You are already the owner'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_new_owner_user_id
  FOR UPDATE;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- Demote current owner first so the temporary state where the
  -- account has zero owners is never visible — both writes happen
  -- in the same function transaction.
  UPDATE profiles SET account_role = 'admin'
  WHERE user_id = auth.uid();

  UPDATE profiles SET account_role = 'owner'
  WHERE user_id = p_new_owner_user_id AND account_id = v_caller_account_id;

  UPDATE accounts SET owner_user_id = p_new_owner_user_id
  WHERE id = v_caller_account_id;
END;
$function$
;

-- Preserve user RPC behavior; serialize membership checks with their writes.
CREATE OR REPLACE FUNCTION public.touch_presence(p_status text DEFAULT 'online'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('online', 'away') THEN
    RAISE EXCEPTION 'Invalid presence status: %', p_status
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  INSERT INTO member_presence (user_id, account_id, status, last_seen_at)
  VALUES (auth.uid(), v_account_id, p_status, now())
  ON CONFLICT (user_id) DO UPDATE
    SET status       = excluded.status,
        last_seen_at = now(),
        account_id   = excluded.account_id;
END;
$function$
;
