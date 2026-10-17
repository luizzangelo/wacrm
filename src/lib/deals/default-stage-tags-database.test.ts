// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20261017215349_inbox_stage_tags_and_default_pipeline.sql',
    import.meta.url
  )
);

const ACCOUNT = '10000000-0000-0000-0000-000000000001';
const USER = '20000000-0000-0000-0000-000000000001';
const CONTACT = '30000000-0000-0000-0000-000000000001';
const PIPELINE = '40000000-0000-0000-0000-000000000001';
const CUSTOM_PIPELINE = '40000000-0000-0000-0000-000000000002';
const DEAL = '50000000-0000-0000-0000-000000000001';

describe('standard funnel and automatic stage tags', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE SCHEMA wacrm_private;
      CREATE TABLE public.accounts (
        id UUID PRIMARY KEY,
        owner_user_id UUID NOT NULL
      );
      CREATE TABLE public.tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES public.accounts(id),
        user_id UUID NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE public.contacts (
        id UUID PRIMARY KEY,
        account_id UUID NOT NULL REFERENCES public.accounts(id)
      );
      CREATE TABLE public.contact_tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID NOT NULL REFERENCES public.contacts(id),
        tag_id UUID NOT NULL REFERENCES public.tags(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(contact_id, tag_id)
      );
      CREATE TABLE public.pipelines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES public.accounts(id),
        user_id UUID NOT NULL,
        name TEXT NOT NULL,
        is_bootstrap BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE public.pipeline_stages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pipeline_id UUID NOT NULL REFERENCES public.pipelines(id),
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        position INTEGER NOT NULL,
        is_lost_stage BOOLEAN NOT NULL DEFAULT FALSE,
        meta_conversion_event TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE public.deals (
        id UUID PRIMARY KEY,
        account_id UUID NOT NULL REFERENCES public.accounts(id),
        user_id UUID NOT NULL,
        pipeline_id UUID NOT NULL REFERENCES public.pipelines(id),
        stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id),
        contact_id UUID REFERENCES public.contacts(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ
      );

      INSERT INTO public.accounts(id, owner_user_id) VALUES ('${ACCOUNT}', '${USER}');
      INSERT INTO public.contacts(id, account_id) VALUES ('${CONTACT}', '${ACCOUNT}');
      INSERT INTO public.tags(account_id, user_id, name, color)
        VALUES ('${ACCOUNT}', '${USER}', 'Lead', '#111111');
      INSERT INTO public.tags(account_id, user_id, name, color)
        VALUES ('${ACCOUNT}', '${USER}', 'VIP', '#222222');
      INSERT INTO public.pipelines(id, account_id, user_id, name)
        VALUES ('${PIPELINE}', '${ACCOUNT}', '${USER}', 'Sales Pipeline');
      INSERT INTO public.pipeline_stages(id, pipeline_id, name, color, position) VALUES
        ('41000000-0000-0000-0000-000000000001', '${PIPELINE}', 'New Lead', '#1', 0),
        ('41000000-0000-0000-0000-000000000002', '${PIPELINE}', 'Qualified', '#2', 1),
        ('41000000-0000-0000-0000-000000000003', '${PIPELINE}', 'Proposal Sent', '#3', 2),
        ('41000000-0000-0000-0000-000000000004', '${PIPELINE}', 'Negotiation', '#4', 3),
        ('41000000-0000-0000-0000-000000000005', '${PIPELINE}', 'Won', '#5', 4);
      INSERT INTO public.pipelines(id, account_id, user_id, name)
        VALUES ('${CUSTOM_PIPELINE}', '${ACCOUNT}', '${USER}', 'Custom');
      INSERT INTO public.pipeline_stages(id, pipeline_id, name, color, position)
        VALUES ('42000000-0000-0000-0000-000000000001', '${CUSTOM_PIPELINE}', 'Lead', '#9', 0);
      INSERT INTO public.deals(
        id, account_id, user_id, pipeline_id, stage_id, contact_id
      ) VALUES (
        '${DEAL}', '${ACCOUNT}', '${USER}', '${PIPELINE}',
        '41000000-0000-0000-0000-000000000001', '${CONTACT}'
      );
    `);

    await db.exec(await readFile(migrationPath, 'utf8'));
  });

  afterEach(async () => {
    await db.close();
  });

  it('renames only the legacy default funnel and reuses matching tags', async () => {
    const standard = await db.query<{
      name: string;
      automatic_tag_id: string;
    }>(`
      SELECT name, automatic_tag_id
      FROM public.pipeline_stages
      WHERE pipeline_id = '${PIPELINE}'
      ORDER BY position
    `);
    expect(standard.rows.map((row) => row.name)).toEqual([
      'Novo Contato',
      'Lead',
      'Lead Qualificado',
      'Lead Desqualificado',
      'Venda Ganha',
    ]);
    expect(standard.rows.every((row) => row.automatic_tag_id)).toBe(true);

    const custom = await db.query<{
      name: string;
      automatic_tag_id: string | null;
    }>(`
      SELECT name, automatic_tag_id FROM public.pipeline_stages
      WHERE pipeline_id = '${CUSTOM_PIPELINE}'
    `);
    expect(custom.rows).toEqual([{ name: 'Lead', automatic_tag_id: null }]);

    const tags = await db.query<{ name: string }>(`
      SELECT name FROM public.tags
      WHERE account_id = '${ACCOUNT}' AND standard_stage_key IS NOT NULL
    `);
    expect(tags.rows).toHaveLength(5);
    expect(tags.rows.filter((row) => row.name === 'Lead')).toHaveLength(1);
  });

  it('keeps manual tags and synchronizes the lifecycle tag on stage changes', async () => {
    const vip = await db.query<{ id: string }>(`
      SELECT id FROM public.tags WHERE account_id = '${ACCOUNT}' AND name = 'VIP'
    `);
    await db.query(
      `INSERT INTO public.contact_tags(contact_id, tag_id) VALUES ($1, $2)`,
      [CONTACT, vip.rows[0].id]
    );

    await db.query(`UPDATE public.deals SET stage_id = $1 WHERE id = $2`, [
      '41000000-0000-0000-0000-000000000002',
      DEAL,
    ]);

    const assigned = await db.query<{ name: string }>(`
      SELECT t.name
      FROM public.contact_tags ct
      JOIN public.tags t ON t.id = ct.tag_id
      WHERE ct.contact_id = '${CONTACT}'
      ORDER BY t.name
    `);
    expect(assigned.rows.map((row) => row.name)).toEqual(['Lead', 'VIP']);
  });

  it('provisions future accounts with the standard linked funnel', async () => {
    const account = '10000000-0000-0000-0000-000000000002';
    const user = '20000000-0000-0000-0000-000000000002';
    await db.query(
      `INSERT INTO public.accounts(id, owner_user_id) VALUES ($1, $2)`,
      [account, user]
    );
    await db.query(`SELECT wacrm_private.provision_account_defaults($1, $2)`, [
      account,
      user,
    ]);

    const stages = await db.query<{ name: string; automatic_tag_id: string }>(`
      SELECT s.name, s.automatic_tag_id
      FROM public.pipeline_stages s
      JOIN public.pipelines p ON p.id = s.pipeline_id
      WHERE p.account_id = '${account}'
      ORDER BY s.position
    `);
    expect(stages.rows.map((row) => row.name)).toEqual([
      'Novo Contato',
      'Lead',
      'Lead Qualificado',
      'Lead Desqualificado',
      'Venda Ganha',
    ]);
    expect(stages.rows.every((row) => row.automatic_tag_id)).toBe(true);
  });
});
