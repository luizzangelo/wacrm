import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260918161120_sync_auth_email_to_profile.sql',
  'utf8'
);
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE ROLE supabase_auth_admin; CREATE SCHEMA auth; CREATE SCHEMA wacrm_private;
    REVOKE ALL ON SCHEMA wacrm_private FROM PUBLIC;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_change text);
    CREATE TABLE public.accounts(id uuid PRIMARY KEY, owner_user_id uuid);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id),
      email text NOT NULL, account_id uuid NOT NULL REFERENCES accounts(id), account_role text NOT NULL, full_name text);
    CREATE TABLE public.account_invitations(account_id uuid, token_hash text);
    INSERT INTO auth.users VALUES ('${a}','new-a@example.invalid',NULL),('${b}','b@example.invalid',NULL);
    INSERT INTO accounts VALUES ('${a}','${a}'),('${b}','${b}');
    -- Deliberately crossed profile PKs: matching by profiles.id would update B.
    INSERT INTO profiles VALUES ('${b}','${a}','stale-a@example.invalid','${a}','owner','A'),
      ('${a}','${b}','b@example.invalid','${b}','agent','B');
    INSERT INTO account_invitations VALUES ('${b}','synthetic-invite');
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA auth TO supabase_auth_admin;
    GRANT SELECT, UPDATE ON auth.users TO supabase_auth_admin;`);
  await db.exec(migration);
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe('Auth email synchronization migration (isolated PostgreSQL)', () => {
  it('reconciles an existing stale copy through user_id, not profile id', async () => {
    const rows = (
      await db.query<Record<string, unknown>>(
        'SELECT email FROM profiles ORDER BY user_id'
      )
    ).rows;
    expect(rows).toEqual([
      { email: 'new-a@example.invalid' },
      { email: 'b@example.invalid' },
    ]);
  });
  it('syncs an Auth-admin update, leaves B and tenant/role/account/invitations intact', async () => {
    const before = (
      await db.query<Record<string, unknown>>(
        'SELECT * FROM profiles ORDER BY user_id'
      )
    ).rows;
    const accounts = (await db.query('SELECT * FROM accounts ORDER BY id'))
      .rows;
    const invites = (await db.query('SELECT * FROM account_invitations')).rows;
    await db.exec(
      `SET ROLE supabase_auth_admin; UPDATE auth.users SET email='changed-a@example.invalid' WHERE id='${a}'; RESET ROLE;`
    );
    const after = (
      await db.query<Record<string, unknown>>(
        'SELECT * FROM profiles ORDER BY user_id'
      )
    ).rows;
    expect(after).toEqual([
      { ...before[0], email: 'changed-a@example.invalid' },
      before[1],
    ]);
    expect((await db.query('SELECT * FROM accounts ORDER BY id')).rows).toEqual(
      accounts
    );
    expect((await db.query('SELECT * FROM account_invitations')).rows).toEqual(
      invites
    );
  });
  it('does not synchronize an unconfirmed email_change request', async () => {
    await db.exec(
      `UPDATE auth.users SET email_change='unconfirmed@example.invalid' WHERE id='${a}'`
    );
    expect(
      (
        await db.query<{ email: string }>(
          'SELECT email FROM profiles WHERE user_id=$1',
          [a]
        )
      ).rows[0].email
    ).toBe('changed-a@example.invalid');
  });
  it('maps NULL to NOT NULL-compatible empty copy without creating a profile', async () => {
    await db.exec(`UPDATE auth.users SET email=NULL WHERE id='${a}'`);
    expect(
      (
        await db.query<{ email: string }>(
          'SELECT email FROM profiles WHERE user_id=$1',
          [a]
        )
      ).rows[0].email
    ).toBe('');
    await db.exec(`INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000003','orphan@example.invalid',NULL);
      UPDATE auth.users SET email='orphan-changed@example.invalid' WHERE id='00000000-0000-4000-8000-000000000003';`);
    expect(
      (
        await db.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM profiles'
        )
      ).rows[0].count
    ).toBe(2);
  });
  it('is idempotent and does not duplicate trigger, profile or account', async () => {
    const before = (await db.query('SELECT * FROM profiles ORDER BY user_id'))
      .rows;
    await db.exec(migration);
    await db.exec(migration);
    expect(
      (await db.query('SELECT * FROM profiles ORDER BY user_id')).rows
    ).toEqual(before);
    expect(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM pg_trigger WHERE tgname='sync_auth_email_to_profile'"
        )
      ).rows[0].count
    ).toBe(1);
  });
  it.each(['anon', 'authenticated', 'service_role'])(
    'is not callable by %s',
    async (role) => {
      expect(
        (
          await db.query<{ allowed: boolean }>(
            "SELECT has_function_privilege($1,'wacrm_private.sync_auth_email_to_profile()','EXECUTE') AS allowed",
            [role]
          )
        ).rows[0].allowed
      ).toBe(false);
      await expect(
        db.exec(
          `SET ROLE ${role}; SELECT wacrm_private.sync_auth_email_to_profile();`
        )
      ).rejects.toThrow();
      await db.exec('RESET ROLE');
    }
  );
  it('has a fixed safe search_path and only an email SET assignment', async () => {
    expect(
      (
        await db.query<{ proconfig: string[] }>(
          "SELECT proconfig FROM pg_proc WHERE oid='wacrm_private.sync_auth_email_to_profile()'::regprocedure"
        )
      ).rows[0].proconfig
    ).toEqual(['search_path=pg_catalog, pg_temp']);
    expect(migration).not.toMatch(
      /SET\s+(account_id|account_role|user_id|id)\s*=/i
    );
    expect(migration).not.toMatch(/INSERT\s+INTO/i);
  });
});
