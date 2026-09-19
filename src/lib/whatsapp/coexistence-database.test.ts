import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    'supabase/migrations/20260919221351_meta_embedded_signup_coexistence.sql'
  ),
  'utf8'
);

const ACCOUNT = '00000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000001';
const CONVERSATION = '20000000-0000-4000-8000-000000000001';

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE FUNCTION uuid_generate_v4() RETURNS UUID
      LANGUAGE SQL VOLATILE AS $$ SELECT gen_random_uuid() $$;
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id UUID PRIMARY KEY);
    CREATE TABLE public.accounts(id UUID PRIMARY KEY);
    CREATE TABLE public.whatsapp_config(
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      account_id UUID NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      phone_number_id TEXT NOT NULL UNIQUE,
      waba_id TEXT,
      access_token TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'disconnected',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE public.conversations(id UUID PRIMARY KEY);
    CREATE TABLE public.messages(
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      conversation_id UUID NOT NULL REFERENCES public.conversations(id),
      message_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    INSERT INTO auth.users(id) VALUES ('${USER}');
    INSERT INTO public.accounts(id) VALUES ('${ACCOUNT}');
    INSERT INTO public.conversations(id) VALUES ('${CONVERSATION}');
    INSERT INTO public.whatsapp_config(account_id,user_id,phone_number_id,waba_id,access_token,status)
      VALUES ('${ACCOUNT}','${USER}','phone-1','waba-1','encrypted','connected');
    INSERT INTO public.messages(conversation_id,message_id)
      VALUES ('${CONVERSATION}','wamid-existing');
  `);
  await db.exec(migration);
}, 30_000);

afterAll(async () => {
  await db?.close();
});

describe('Embedded Signup + Coexistence migration', () => {
  it('preserves manual configurations and existing messages with safe defaults', async () => {
    expect(
      (
        await db.query<{
          connection_mode: string;
          subscription_status: string;
        }>('SELECT connection_mode, subscription_status FROM whatsapp_config')
      ).rows[0]
    ).toEqual({ connection_mode: 'manual', subscription_status: 'unknown' });

    expect(
      (await db.query<{ source: string }>('SELECT source FROM messages'))
        .rows[0]
    ).toEqual({ source: 'cloud_api' });
  });

  it('accepts only known modes, sync states and message origins', async () => {
    await expect(
      db.exec("UPDATE whatsapp_config SET connection_mode='takeover'")
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.exec("UPDATE whatsapp_config SET history_sync_status='retrying'")
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.exec("UPDATE messages SET source='webhook_unknown'")
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps pending token escrow inaccessible to browser database roles', async () => {
    const privileges = (
      await db.query<{
        anon: boolean;
        authenticated: boolean;
        service: boolean;
      }>(`
        SELECT
          has_table_privilege('anon','public.whatsapp_embedded_signup_sessions','SELECT') AS anon,
          has_table_privilege('authenticated','public.whatsapp_embedded_signup_sessions','SELECT') AS authenticated,
          has_table_privilege('service_role','public.whatsapp_embedded_signup_sessions','SELECT') AS service
      `)
    ).rows[0];

    expect(privileges).toEqual({
      anon: false,
      authenticated: false,
      service: true,
    });
    expect(
      (
        await db.query<{ enabled: boolean }>(`
          SELECT relrowsecurity AS enabled
          FROM pg_class
          WHERE oid='public.whatsapp_embedded_signup_sessions'::regclass
        `)
      ).rows[0].enabled
    ).toBe(true);
  });

  it('is replay-safe', async () => {
    await expect(db.exec(migration)).resolves.toBeDefined();
    expect(
      (
        await db.query<{ count: number }>(`
          SELECT count(*)::int AS count
          FROM information_schema.columns
          WHERE table_schema='public'
            AND table_name='whatsapp_config'
            AND column_name='connection_mode'
        `)
      ).rows[0].count
    ).toBe(1);
  });
});
