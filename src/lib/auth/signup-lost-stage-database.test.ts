import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260919161755_fix_auth_bootstrap_lost_stage_privilege.sql',
  'utf8'
);
const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';

let db: PGlite | undefined;

async function database(applyFix = true) {
  const instance = new PGlite();
  await instance.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE ROLE supabase_auth_admin;
    CREATE SCHEMA auth;

    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text NOT NULL
    );
    CREATE TABLE public.accounts (
      id uuid PRIMARY KEY,
      owner_user_id uuid NOT NULL
    );
    CREATE TABLE public.profiles (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id),
      account_id uuid NOT NULL REFERENCES public.accounts(id),
      account_role text NOT NULL
    );
    CREATE TABLE public.pipelines (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL REFERENCES public.accounts(id),
      user_id uuid NOT NULL,
      name text NOT NULL
    );
    CREATE TABLE public.pipeline_stages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      pipeline_id uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
      name text NOT NULL,
      position integer NOT NULL DEFAULT 0,
      is_lost_stage boolean NOT NULL DEFAULT false
    );
    CREATE UNIQUE INDEX idx_pipeline_stages_one_lost
      ON public.pipeline_stages(pipeline_id) WHERE is_lost_stage;

    ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tenant_pipeline_read ON public.pipelines FOR SELECT TO authenticated
      USING (account_id::text = current_setting('test.account', true));
    CREATE POLICY tenant_pipeline_write ON public.pipelines FOR UPDATE TO authenticated
      USING (account_id::text = current_setting('test.account', true))
      WITH CHECK (account_id::text = current_setting('test.account', true));
    CREATE POLICY tenant_stage_read ON public.pipeline_stages FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.pipelines p
        WHERE p.id = pipeline_id
          AND p.account_id::text = current_setting('test.account', true)
      ));

    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, supabase_auth_admin;
    GRANT USAGE ON SCHEMA auth TO supabase_auth_admin;
    GRANT INSERT ON auth.users TO supabase_auth_admin;
    GRANT SELECT, UPDATE ON public.pipelines TO authenticated;
    GRANT SELECT ON public.pipeline_stages TO authenticated;

    CREATE FUNCTION public.initialize_pipeline_lost_stage()
    RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
    BEGIN
      INSERT INTO public.pipeline_stages(pipeline_id,name,position,is_lost_stage)
        VALUES(NEW.id,'Venda perdida',0,true);
      RETURN NEW;
    END $$;
    CREATE TRIGGER initialize_pipeline_lost_stage
      AFTER INSERT ON public.pipelines FOR EACH ROW
      EXECUTE FUNCTION public.initialize_pipeline_lost_stage();

    CREATE FUNCTION public.require_pipeline_lost_stage()
    RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
    DECLARE pipeline uuid;
    BEGIN
      IF TG_TABLE_NAME = 'pipelines' THEN pipeline := NEW.id;
      ELSE pipeline := CASE WHEN TG_OP = 'DELETE' THEN OLD.pipeline_id ELSE NEW.pipeline_id END;
      END IF;
      IF EXISTS (SELECT 1 FROM public.pipelines WHERE id = pipeline) AND
        (SELECT count(*) FROM public.pipeline_stages
          WHERE pipeline_id = pipeline AND is_lost_stage) <> 1 THEN
        RAISE EXCEPTION 'pipeline_requires_one_lost_stage' USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END $$;
    CREATE CONSTRAINT TRIGGER require_pipeline_lost_stage
      AFTER INSERT OR UPDATE OR DELETE ON public.pipeline_stages
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION public.require_pipeline_lost_stage();
    CREATE CONSTRAINT TRIGGER require_new_pipeline_lost_stage
      AFTER INSERT ON public.pipelines DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION public.require_pipeline_lost_stage();
    REVOKE ALL ON FUNCTION public.require_pipeline_lost_stage()
      FROM PUBLIC, anon, authenticated, supabase_auth_admin;
    GRANT EXECUTE ON FUNCTION public.require_pipeline_lost_stage() TO service_role;

    CREATE FUNCTION public.bootstrap_owner_defaults()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp AS $$
    BEGIN
      INSERT INTO public.pipelines(account_id,user_id,name)
        VALUES(NEW.account_id,NEW.user_id,'Sales Pipeline');
      RETURN NEW;
    END $$;
    CREATE TRIGGER owner_defaults AFTER INSERT ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.bootstrap_owner_defaults();

    CREATE FUNCTION public.handle_new_user()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp AS $$
    BEGIN
      INSERT INTO public.accounts(id,owner_user_id) VALUES(NEW.id,NEW.id);
      INSERT INTO public.profiles(user_id,account_id,account_role)
        VALUES(NEW.id,NEW.id,'owner');
      RETURN NEW;
    END $$;
    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  `);
  if (applyFix) await instance.exec(migration);
  return instance;
}

async function signup(instance: PGlite, id: string) {
  await instance.exec(`
    SET ROLE supabase_auth_admin;
    BEGIN;
    INSERT INTO auth.users(id,email) VALUES('${id}','test@example.invalid');
    COMMIT;
    RESET ROLE;
  `);
}

afterEach(async () => {
  await db?.close();
  db = undefined;
});

describe(
  'lost-stage validation during Supabase Auth bootstrap',
  { timeout: 30_000 },
  () => {
    it('reproduces the underlying SQLSTATE 42501 table access', async () => {
      db = await database(false);
      await db.exec('SET ROLE supabase_auth_admin');
      await expect(db.query('SELECT 1 FROM public.pipelines')).rejects.toThrow(
        'permission denied for table pipelines'
      );
    });

    it('lets the restricted Auth role reach COMMIT without table SELECT', async () => {
      db = await database();
      expect(
        (
          await db.query<{ allowed: boolean }>(
            "SELECT has_table_privilege('supabase_auth_admin','public.pipelines','SELECT') AS allowed"
          )
        ).rows[0].allowed
      ).toBe(false);
      await signup(db, USER_A);
      expect(
        (
          await db.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM auth.users WHERE id=$1',
            [USER_A]
          )
        ).rows[0].count
      ).toBe(1);
      expect(
        (
          await db.query<{ count: number }>(
            `SELECT count(*)::int AS count
           FROM public.pipeline_stages s
           JOIN public.pipelines p ON p.id=s.pipeline_id
           WHERE p.account_id=$1 AND s.is_lost_stage`,
            [USER_A]
          )
        ).rows[0].count
      ).toBe(1);
    });

    it('rejects zero lost stages and accepts exactly one', async () => {
      db = await database();
      await signup(db, USER_A);
      await db.exec('BEGIN');
      await db.exec(
        `DELETE FROM public.pipeline_stages
       WHERE pipeline_id=(SELECT id FROM public.pipelines WHERE account_id='${USER_A}')
         AND is_lost_stage`
      );
      await expect(db.exec('SET CONSTRAINTS ALL IMMEDIATE')).rejects.toThrow(
        'pipeline_requires_one_lost_stage'
      );
      await db.exec('ROLLBACK');
      await db.exec('BEGIN; SET CONSTRAINTS ALL IMMEDIATE; COMMIT;');
    });

    it('rejects multiple lost stages at both unique and deferred boundaries', async () => {
      db = await database();
      await signup(db, USER_A);
      const pipeline = (
        await db.query<{ id: string }>(
          'SELECT id FROM public.pipelines WHERE account_id=$1',
          [USER_A]
        )
      ).rows[0].id;
      await expect(
        db.query(
          `INSERT INTO public.pipeline_stages(pipeline_id,name,is_lost_stage)
         VALUES($1,'Duplicate',true)`,
          [pipeline]
        )
      ).rejects.toThrow('idx_pipeline_stages_one_lost');

      await db.exec('DROP INDEX public.idx_pipeline_stages_one_lost; BEGIN;');
      await db.query(
        `INSERT INTO public.pipeline_stages(pipeline_id,name,is_lost_stage)
       VALUES($1,'Duplicate',true)`,
        [pipeline]
      );
      await expect(db.exec('SET CONSTRAINTS ALL IMMEDIATE')).rejects.toThrow(
        'pipeline_requires_one_lost_stage'
      );
    });

    it('keeps tenant A unable to read or modify tenant B', async () => {
      db = await database();
      await signup(db, USER_A);
      await signup(db, USER_B);
      await db.exec(`SET ROLE authenticated; SET test.account='${USER_A}';`);
      expect(
        (
          await db.query<{ account_id: string }>(
            'SELECT account_id FROM public.pipelines'
          )
        ).rows
      ).toEqual([{ account_id: USER_A }]);
      expect(
        (
          await db.query<{ count: number }>(
            `WITH changed AS (
             UPDATE public.pipelines SET name='forged' WHERE account_id=$1 RETURNING 1
           ) SELECT count(*)::int AS count FROM changed`,
            [USER_B]
          )
        ).rows[0].count
      ).toBe(0);
      await db.exec('RESET ROLE');
    });

    it('has a trusted owner, safe path and no new public callable surface', async () => {
      db = await database();
      const metadata = (
        await db.query<{
          owner: string;
          security_definer: boolean;
          config: string[];
        }>(`
        SELECT r.rolname AS owner,
          p.prosecdef AS security_definer,
          p.proconfig AS config
        FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
        WHERE p.oid='public.require_pipeline_lost_stage()'::regprocedure
      `)
      ).rows[0];
      expect(metadata).toEqual({
        owner: 'postgres',
        security_definer: true,
        config: ['search_path=pg_catalog, pg_temp'],
      });
      for (const role of [
        'public',
        'anon',
        'authenticated',
        'supabase_auth_admin',
      ]) {
        expect(
          (
            await db.query<{ allowed: boolean }>(
              "SELECT has_function_privilege($1,'public.require_pipeline_lost_stage()','EXECUTE') AS allowed",
              [role]
            )
          ).rows[0].allowed
        ).toBe(false);
      }
      expect(migration).not.toMatch(/EXECUTE\s+(format|\()/i);
    });

    it('does not broaden anon, authenticated or Auth-admin table privileges', async () => {
      db = await database();
      for (const role of ['anon', 'supabase_auth_admin']) {
        for (const table of ['pipelines', 'pipeline_stages']) {
          expect(
            (
              await db.query<{ allowed: boolean }>(
                `SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS allowed`,
                [role, `public.${table}`]
              )
            ).rows[0].allowed
          ).toBe(false);
        }
      }
      expect(
        (
          await db.query<{ allowed: boolean }>(
            "SELECT has_table_privilege('authenticated','public.pipelines','INSERT,DELETE') AS allowed"
          )
        ).rows[0].allowed
      ).toBe(false);
    });

    it('preserves both deferred constraint triggers', async () => {
      db = await database();
      const triggers = (
        await db.query<{ name: string; deferred: boolean }>(`
        SELECT tgname AS name, tginitdeferred AS deferred
        FROM pg_trigger
        WHERE tgfoid='public.require_pipeline_lost_stage()'::regprocedure
          AND NOT tgisinternal
        ORDER BY tgname
      `)
      ).rows;
      expect(triggers).toEqual([
        { name: 'require_new_pipeline_lost_stage', deferred: true },
        { name: 'require_pipeline_lost_stage', deferred: true },
      ]);
    });
  }
);
