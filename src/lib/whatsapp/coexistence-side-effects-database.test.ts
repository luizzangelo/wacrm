import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    'supabase/migrations/20260919223140_guard_coexistence_import_side_effects.sql'
  ),
  'utf8'
);

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE public.messages(
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'cloud_api'
    );
    CREATE TABLE public.side_effects(message_id BIGINT NOT NULL);
    CREATE FUNCTION public.create_deal_on_whatsapp_inbound()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO public.side_effects(message_id) VALUES (NEW.id);
      RETURN NEW;
    END $$;
    CREATE TRIGGER create_deal_on_whatsapp_inbound
      AFTER INSERT ON public.messages
      FOR EACH ROW EXECUTE FUNCTION public.create_deal_on_whatsapp_inbound();
  `);
  await db.exec(migration);
}, 30_000);

afterAll(async () => db?.close());

describe('coexistence database side-effect guard', () => {
  it('allows automatic-deal side effects only for live Cloud API messages', async () => {
    await db.exec(`
      INSERT INTO messages(source) VALUES
        ('coexistence_history'),
        ('whatsapp_business_app'),
        ('cloud_api');
    `);
    expect(
      (
        await db.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM side_effects'
        )
      ).rows[0].count
    ).toBe(1);
  });
});
