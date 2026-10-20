BEGIN;

-- Every personal account is provisioned with the standard tag library.
-- Tags are therefore not evidence of user data and must not prevent a solo
-- owner from accepting an invitation. All other data-loss guards remain.
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

COMMIT;
