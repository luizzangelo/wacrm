BEGIN;

CREATE TABLE public.task_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(BTRIM(name)) BETWEEN 1 AND 80),
  icon TEXT NOT NULL DEFAULT 'circle',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX task_types_account_name_unique
  ON public.task_types(account_id, LOWER(BTRIM(name)));
CREATE INDEX task_types_account_idx ON public.task_types(account_id);

CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  task_type_id UUID NOT NULL REFERENCES public.task_types(id) ON DELETE RESTRICT,
  text TEXT NOT NULL CHECK (char_length(BTRIM(text)) BETWEEN 1 AND 500),
  due_at TIMESTAMPTZ NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_to UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  result_text TEXT CHECK (result_text IS NULL OR char_length(result_text) <= 500),
  due_notification_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((completed_at IS NULL AND completed_by IS NULL) OR completed_at IS NOT NULL)
);

CREATE INDEX tasks_account_assignee_due_idx
  ON public.tasks(account_id, assigned_to, due_at)
  WHERE completed_at IS NULL;
CREATE INDEX tasks_account_due_idx
  ON public.tasks(account_id, due_at)
  WHERE completed_at IS NULL;
CREATE INDEX tasks_contact_idx ON public.tasks(contact_id);
CREATE INDEX tasks_conversation_idx ON public.tasks(conversation_id)
  WHERE conversation_id IS NOT NULL;
CREATE INDEX tasks_type_idx ON public.tasks(task_type_id);

CREATE FUNCTION wacrm_private.validate_task_tenant_links()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.due_at IS DISTINCT FROM OLD.due_at
    OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
  ) THEN
    NEW.due_notification_sent_at = NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = NEW.contact_id AND c.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'task contact must belong to account' USING ERRCODE = '23514';
  END IF;
  IF NEW.conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = NEW.conversation_id
      AND c.account_id = NEW.account_id
      AND c.contact_id = NEW.contact_id
  ) THEN
    RAISE EXCEPTION 'task conversation must belong to contact and account' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.task_types tt
    WHERE tt.id = NEW.task_type_id AND tt.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'task type must belong to account' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = NEW.assigned_to AND p.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'task assignee must belong to account' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION wacrm_private.validate_task_tenant_links()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER validate_task_tenant_links
BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION wacrm_private.validate_task_tenant_links();

ALTER TABLE public.task_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_types_select ON public.task_types
  FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY task_types_insert ON public.task_types
  FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY task_types_update ON public.task_types
  FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY task_types_delete ON public.task_types
  FOR DELETE TO authenticated
  USING (public.is_account_member(account_id, 'admin'));

CREATE POLICY tasks_select ON public.tasks
  FOR SELECT TO authenticated
  USING (
    public.is_account_member(account_id, 'admin')
    OR assigned_to = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.account_id = tasks.account_id
        AND c.contact_id = tasks.contact_id
        AND c.assigned_agent_id = (SELECT auth.uid())
    )
  );
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_account_member(account_id, 'agent')
    AND created_by = (SELECT auth.uid())
    AND (
      public.is_account_member(account_id, 'admin')
      OR (
        assigned_to = (SELECT auth.uid())
        AND EXISTS (
          SELECT 1 FROM public.conversations c
          WHERE c.account_id = tasks.account_id
            AND c.contact_id = tasks.contact_id
            AND c.assigned_agent_id = (SELECT auth.uid())
        )
      )
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.account_id = tasks.account_id AND p.user_id = tasks.assigned_to
    )
  );
CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    public.is_account_member(account_id, 'admin')
    OR assigned_to = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.account_id = tasks.account_id
        AND c.contact_id = tasks.contact_id
        AND c.assigned_agent_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    public.is_account_member(account_id, 'agent')
    AND (
      public.is_account_member(account_id, 'admin')
      OR assigned_to = (SELECT auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.account_id = tasks.account_id AND p.user_id = tasks.assigned_to
    )
  );
CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE TO authenticated
  USING (
    public.is_account_member(account_id, 'admin')
    OR assigned_to = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.account_id = tasks.account_id
        AND c.contact_id = tasks.contact_id
        AND c.assigned_agent_id = (SELECT auth.uid())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;

CREATE FUNCTION public.get_my_task_badge_count()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COUNT(*)
  FROM public.tasks t
  WHERE t.assigned_to = (SELECT auth.uid())
    AND t.completed_at IS NULL
    AND t.due_at < (
      (((NOW() AT TIME ZONE 'America/Sao_Paulo')::date + 1)::timestamp)
      AT TIME ZONE 'America/Sao_Paulo'
    );
$$;
REVOKE ALL ON FUNCTION public.get_my_task_badge_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_task_badge_count() TO authenticated;

INSERT INTO public.task_types(account_id, name, icon, is_default)
SELECT a.id, v.name, v.icon, TRUE
FROM public.accounts a
CROSS JOIN (VALUES
  ('Acompanhar', 'circle-check'),
  ('Ligar', 'phone'),
  ('Reunião', 'users'),
  ('Enviar proposta', 'file-text'),
  ('Enviar mensagem', 'message-square')
) AS v(name, icon)
ON CONFLICT (account_id, (LOWER(BTRIM(name)))) DO NOTHING;

CREATE FUNCTION wacrm_private.provision_default_task_types()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.task_types(account_id, name, icon, is_default)
  VALUES
    (NEW.id, 'Acompanhar', 'circle-check', TRUE),
    (NEW.id, 'Ligar', 'phone', TRUE),
    (NEW.id, 'Reunião', 'users', TRUE),
    (NEW.id, 'Enviar proposta', 'file-text', TRUE),
    (NEW.id, 'Enviar mensagem', 'message-square', TRUE)
  ON CONFLICT (account_id, (LOWER(BTRIM(name)))) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION wacrm_private.provision_default_task_types()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER provision_default_task_types
AFTER INSERT ON public.accounts
FOR EACH ROW EXECUTE FUNCTION wacrm_private.provision_default_task_types();

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'task_assigned', 'task_due'));
ALTER TABLE public.notifications
  ADD COLUMN task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE;
CREATE INDEX notifications_task_idx ON public.notifications(task_id)
  WHERE task_id IS NOT NULL;
CREATE UNIQUE INDEX notifications_task_due_unique
  ON public.notifications(task_id, user_id, type);

CREATE FUNCTION wacrm_private.notify_task_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE contact_name TEXT;
BEGIN
  IF NEW.assigned_to = NEW.created_by THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(NULLIF(c.name, ''), c.phone) INTO contact_name
  FROM public.contacts c WHERE c.id = NEW.contact_id;
  INSERT INTO public.notifications(
    account_id, user_id, type, conversation_id, contact_id, task_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id, NEW.assigned_to, 'task_assigned', NEW.conversation_id,
    NEW.contact_id, NEW.id, NEW.created_by, 'Nova tarefa atribuída',
    NEW.text || ' · ' || COALESCE(contact_name, 'Contato')
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'task_assignment_notification_failed task=%', NEW.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION wacrm_private.notify_task_assignment()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER notify_task_assignment
AFTER INSERT OR UPDATE OF assigned_to ON public.tasks
FOR EACH ROW EXECUTE FUNCTION wacrm_private.notify_task_assignment();

ALTER TABLE public.tasks REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public' AND tablename = 'tasks'
    ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
  END IF;
END;
$$;

COMMIT;
