import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const ACCOUNT = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const CONTACT = '10000000-0000-4000-8000-000000000001';
const PIPELINE = '20000000-0000-4000-8000-000000000001';
const OTHER_PIPELINE = '20000000-0000-4000-8000-000000000002';
const INITIAL = '30000000-0000-4000-8000-000000000001';
const LEAD = '30000000-0000-4000-8000-000000000002';
const CONV = '60000000-0000-4000-8000-000000000001';
const OTHER_CONV = '60000000-0000-4000-8000-000000000002';
const ATTRIBUTION = '40000000-0000-4000-8000-000000000001';
let db: PGlite;
const fetchSpy = vi.fn(() => {
  throw new Error('No network in inbound tests');
});
async function inbound(
  id = 'wamid.first',
  sender = 'customer',
  type = 'text',
  text: string | null = 'Hello',
  conv = CONV,
  time = '2026-09-17T10:00:00Z'
) {
  await db.query(
    `INSERT INTO messages(conversation_id,message_id,sender_type,content_type,content_text,created_at)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(conversation_id,message_id) DO NOTHING`,
    [conv, id, sender, type, text, time]
  );
}
async function deals() {
  return (
    await db.query<Record<string, unknown>>(
      'SELECT * FROM deals ORDER BY created_at,id'
    )
  ).rows;
}
async function events() {
  return (
    await db.query<Record<string, unknown>>(
      'SELECT * FROM meta_conversion_events ORDER BY id'
    )
  ).rows;
}
async function summaries(pipeline = PIPELINE) {
  return (
    await db.query<Record<string, unknown>>(
      'SELECT * FROM get_deal_conversation_summaries($1)',
      [pipeline]
    )
  ).rows;
}
async function move(
  deal: unknown,
  stage: unknown,
  reason: string | null = null
) {
  return (
    await db.query<{ result: Record<string, unknown> }>(
      'SELECT move_deal_to_stage_with_conversion_intent($1,$2,$3,$4) result',
      [ACCOUNT, deal, stage, reason]
    )
  ).rows[0].result;
}
async function lost() {
  return (
    await db.query<{ id: string }>(
      'SELECT id FROM pipeline_stages WHERE pipeline_id=$1 AND is_lost_stage',
      [PIPELINE]
    )
  ).rows[0].id;
}
beforeAll(async () => {
  db = new PGlite();
  for (const path of [
    'src/lib/deals/lifecycle-schema.fixture.sql',
    'src/lib/deals/inbound-schema.fixture.sql',
    'supabase/migrations/040_meta_conversions_foundation.sql',
    'supabase/migrations/041_meta_conversion_stage_outbox.sql',
    'supabase/migrations/20260917035905_deal_initial_stage_and_loss.sql',
    'supabase/migrations/20260917051426_inbound_deal_and_card_context.sql',
  ])
    await db.exec(readFileSync(path, 'utf8'));
  await db.exec(`UPDATE pipeline_stages SET meta_conversion_event='LeadSubmitted' WHERE id='${LEAD}';
    INSERT INTO meta_conversion_config(account_id,dataset_id,access_token,enabled) VALUES('${ACCOUNT}','fake-dataset','fake-token',true);`);
}, 30000);
beforeEach(async () => {
  await db.exec('BEGIN; SET LOCAL ROLE service_role');
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
});
afterEach(async () => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  await db.exec('ROLLBACK');
});
afterAll(async () => {
  await db.close();
});

describe('actual inbound migration: automatic deal and read-only card summaries', () => {
  it('first inbound creates exactly one deal in the first normal stage with server title', async () => {
    await inbound();
    expect(await deals()).toMatchObject([
      {
        account_id: ACCOUNT,
        contact_id: CONTACT,
        conversation_id: CONV,
        pipeline_id: PIPELINE,
        stage_id: INITIAL,
        title: 'Current contact',
        status: 'open',
        currency: 'BRL',
        meta_attribution_id: null,
      },
    ]);
    expect(await events()).toHaveLength(0);
  });
  it('uses account currency instead of a hardcoded default', async () => {
    await db.exec(
      `UPDATE accounts SET default_currency='EUR' WHERE id='${ACCOUNT}'`
    );
    await inbound();
    expect((await deals())[0].currency).toBe('EUR');
  });
  it('subsequent genuine messages never create a second deal', async () => {
    await inbound();
    await inbound('wamid.second');
    expect(await deals()).toHaveLength(1);
    expect(await events()).toHaveLength(0);
  });
  it('duplicate webhook delivery is a no-op', async () => {
    await inbound();
    const before = await deals();
    await inbound();
    expect(await deals()).toEqual(before);
  });
  it('does not duplicate an existing manual deal, even in another pipeline', async () => {
    await db.query(
      `INSERT INTO pipelines(id,account_id,user_id,name,created_at) VALUES(gen_random_uuid(),$1,$1,'Second','2026-09-18') RETURNING id`,
      [ACCOUNT]
    );
    const p = (
      await db.query<{ id: string }>(
        "SELECT id FROM pipelines WHERE name='Second'"
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO pipeline_stages(pipeline_id,name) VALUES($1,'Start')",
      [p]
    );
    await db.query(
      'INSERT INTO deals(account_id,user_id,pipeline_id,contact_id) VALUES($1,$1,$2,$3)',
      [ACCOUNT, p, CONTACT]
    );
    const before = await deals();
    await inbound();
    expect(await deals()).toEqual(before);
  });
  it('won in a normal stage also counts as existing non-lost context', async () => {
    await inbound();
    await db.exec("UPDATE deals SET status='won'");
    await inbound('wamid.next');
    expect(await deals()).toHaveLength(1);
  });
  it('only lost deals: creates a new open deal without reopening or changing the lost one', async () => {
    await inbound();
    const old = (await deals())[0];
    await move(old.id, await lost(), 'price');
    const before = await deals();
    await inbound('wamid.new');
    const after = await deals();
    expect(after).toHaveLength(2);
    expect(after.find((d) => d.id === old.id)).toEqual(before[0]);
    expect(after.find((d) => d.id !== old.id)).toMatchObject({
      stage_id: INITIAL,
      status: 'open',
      lost_reason: null,
    });
    expect(await events()).toHaveLength(0);
  });
  it('mapped initial stage still does not create conversion on insert', async () => {
    await db.exec(
      `UPDATE pipeline_stages SET meta_conversion_event=NULL WHERE id='${LEAD}'; UPDATE pipeline_stages SET meta_conversion_event='LeadSubmitted' WHERE id='${INITIAL}'`
    );
    await inbound();
    expect(await events()).toHaveLength(0);
  });
  it('CTWA capture remains independent; Initial -> Lead still freezes and creates one intent', async () => {
    await inbound();
    const deal = (await deals())[0];
    await db.query(
      `INSERT INTO meta_ad_attributions(id,account_id,contact_id,conversation_id,ctwa_clid,waba_id) VALUES($1,$2,$3,$4,'fake-original-click','fake-waba')`,
      [ATTRIBUTION, ACCOUNT, CONTACT, CONV]
    );
    expect((await deals())[0].meta_attribution_id).toBeNull();
    expect(await events()).toHaveLength(0);
    expect(await move(deal.id, LEAD)).toMatchObject({
      ok: true,
      conversionEventCreated: true,
    });
    expect(await events()).toMatchObject([
      {
        event_name: 'LeadSubmitted',
        status: 'pending',
        attempts: 0,
        attribution_id: ATTRIBUTION,
      },
    ]);
    expect((await deals())[0].meta_attribution_id).toBe(ATTRIBUTION);
    await move(deal.id, await lost(), 'other');
    await move(deal.id, INITIAL);
    await move(deal.id, LEAD);
    expect(await events()).toHaveLength(1);
    expect((await deals())[0].meta_attribution_id).toBe(ATTRIBUTION);
  });
  it.each(['agent', 'bot'])(
    '%s messages never auto-create deals',
    async (sender) => {
      await inbound('wamid.out', sender);
      expect(await deals()).toHaveLength(0);
    }
  );
  it('empty unsupported text is not useful inbound', async () => {
    await inbound('wamid.empty', 'customer', 'text', '  ');
    expect(await deals()).toHaveLength(0);
    await inbound('wamid.useful');
    expect(await deals()).toHaveLength(1);
  });
  it('messages without WhatsApp id do not auto-create deals', async () => {
    await db.exec(
      `INSERT INTO messages(conversation_id,sender_type,content_text) VALUES('${CONV}','customer','Manual')`
    );
    expect(await deals()).toHaveLength(0);
  });
  it.each(['image', 'audio', 'video', 'document', 'interactive', 'location'])(
    'useful %s inbound can create deal without text',
    async (type) => {
      await inbound('wamid.media', 'customer', type, null);
      expect(await deals()).toHaveLength(1);
    }
  );
  it('no configured pipeline does not break inbound or invent a pipeline', async () => {
    await db.exec(
      `DELETE FROM pipeline_stages WHERE pipeline_id='${PIPELINE}' AND NOT is_lost_stage`
    );
    await inbound();
    expect(await deals()).toHaveLength(0);
    expect((await db.query('SELECT * FROM messages')).rows).toHaveLength(1);
  });
  it('resolves the oldest eligible pipeline by created_at then id', async () => {
    await db.exec(`INSERT INTO pipelines(id,account_id,user_id,name,created_at) VALUES('20000000-0000-4000-8000-000000000000','${ACCOUNT}','${ACCOUNT}','Default','2000-01-01');
      INSERT INTO pipeline_stages(pipeline_id,name) VALUES('20000000-0000-4000-8000-000000000000','Start')`);
    await inbound();
    expect((await deals())[0].pipeline_id).toBe(
      '20000000-0000-4000-8000-000000000000'
    );
  });
  it('skips older pipelines that have no normal stage', async () => {
    await db.exec(
      `INSERT INTO pipelines(account_id,user_id,name,created_at) VALUES('${ACCOUNT}','${ACCOUNT}','Incomplete','1990-01-01')`
    );
    await inbound();
    expect((await deals())[0].pipeline_id).toBe(PIPELINE);
  });
  it('separates automatic deals and summaries by account', async () => {
    await inbound();
    await inbound(
      'wamid.other',
      'customer',
      'text',
      'Other private message',
      OTHER_CONV
    );
    expect(await deals()).toHaveLength(2);
    expect(
      (await deals()).filter((d) => d.account_id === OTHER)[0].pipeline_id
    ).toBe(OTHER_PIPELINE);
    expect((await summaries())[0].last_message_text).toBe('Hello');
    await db.exec(
      `RESET ROLE; SET LOCAL test.account='${ACCOUNT}'; SET LOCAL test.member_role='viewer'; SET LOCAL ROLE authenticated`
    );
    expect(await summaries(OTHER_PIPELINE)).toHaveLength(0);
    expect(await summaries()).toHaveLength(1);
  });
  it('latest message includes outbound while registration remains first customer message', async () => {
    await inbound(
      'wamid.agent-old',
      'agent',
      'text',
      'Before',
      CONV,
      '2026-09-16T10:00:00Z'
    );
    await inbound();
    await inbound(
      'wamid.reply',
      'agent',
      'text',
      'Latest answer',
      CONV,
      '2026-09-18T10:00:00Z'
    );
    expect((await summaries())[0]).toMatchObject({
      conversation_id: CONV,
      last_message_text: 'Latest answer',
      first_inbound_at: new Date('2026-09-17T10:00:00Z'),
    });
  });
  it('unlinked manual deal resolves the contact conversation safely', async () => {
    await db.query(
      'INSERT INTO deals(account_id,user_id,pipeline_id,contact_id) VALUES($1,$1,$2,$3)',
      [ACCOUNT, PIPELINE, CONTACT]
    );
    await inbound();
    expect((await summaries())[0].conversation_id).toBe(CONV);
  });
  it('no conversation produces empty message/date summaries', async () => {
    await db.exec(`DELETE FROM conversations WHERE id='${CONV}'`);
    await db.query(
      'INSERT INTO deals(account_id,user_id,pipeline_id,contact_id) VALUES($1,$1,$2,$3)',
      [ACCOUNT, PIPELINE, CONTACT]
    );
    expect((await summaries())[0]).toMatchObject({
      conversation_id: null,
      last_message_text: null,
      first_inbound_at: null,
    });
  });
  it('conversation without messages produces safe null summaries', async () => {
    await db.query(
      'INSERT INTO deals(account_id,user_id,pipeline_id,contact_id) VALUES($1,$1,$2,$3)',
      [ACCOUNT, PIPELINE, CONTACT]
    );
    expect((await summaries())[0]).toMatchObject({
      conversation_id: CONV,
      last_message_text: null,
      first_inbound_at: null,
    });
  });
  it('does not use conversation cached text as actual latest message', async () => {
    await inbound();
    await db.exec(`UPDATE conversations SET last_message_text='Stale'`);
    expect((await summaries())[0].last_message_text).toBe('Hello');
  });
  it('limits preview to 240 characters and never returns media URLs or customer fields', async () => {
    await inbound('wamid.long', 'customer', 'text', 'x'.repeat(500));
    const s = (await summaries())[0];
    expect(String(s.last_message_text)).toHaveLength(240);
    expect(Object.keys(s).sort()).toEqual([
      'conversation_id',
      'deal_id',
      'first_inbound_at',
      'last_message_text',
      'last_message_type',
    ]);
  });
  it('direct browser customer insert cannot invoke trusted inbound creation', async () => {
    await db.exec(
      `RESET ROLE; SET LOCAL test.account='${ACCOUNT}'; SET LOCAL test.member_role='agent'; SET LOCAL ROLE authenticated`
    );
    await inbound();
    expect(await deals()).toHaveLength(0);
  });
  it('trigger helpers are not public callable RPCs', async () => {
    for (const fn of [
      'lock_deal_contact_context()',
      'create_deal_on_whatsapp_inbound()',
    ]) {
      expect(
        (
          await db.query<{ allowed: boolean }>(
            'SELECT has_function_privilege($1,$2,$3) allowed',
            ['authenticated', fn, 'EXECUTE']
          )
        ).rows[0].allowed
      ).toBe(false);
    }
  });
  it('manual creation still works for an authorized agent with the new lock trigger', async () => {
    await db.exec(
      `RESET ROLE; SET LOCAL test.account='${ACCOUNT}'; SET LOCAL test.member_role='agent'; SET LOCAL ROLE authenticated`
    );
    await db.query(
      'INSERT INTO deals(account_id,user_id,pipeline_id,contact_id) VALUES($1,$1,$2,$3)',
      [ACCOUNT, PIPELINE, CONTACT]
    );
    expect(await deals()).toMatchObject([
      { stage_id: INITIAL, title: 'Current contact' },
    ]);
  });
  it('viewer cannot create manual deals or messages', async () => {
    await db.exec(
      `RESET ROLE; SET LOCAL test.account='${ACCOUNT}'; SET LOCAL test.member_role='viewer'; SET LOCAL ROLE authenticated`
    );
    await expect(
      db.query(
        'INSERT INTO deals(account_id,user_id,pipeline_id,contact_id) VALUES($1,$1,$2,$3)',
        [ACCOUNT, PIPELINE, CONTACT]
      )
    ).rejects.toThrow('row-level security');
  });
  it('malformed cross-account conversation cannot auto-create a deal or expose preview', async () => {
    await db.exec(
      `UPDATE conversations SET contact_id='${CONTACT}' WHERE id='${OTHER_CONV}'`
    );
    await inbound(
      'wamid.foreign',
      'customer',
      'text',
      'Foreign fixture',
      OTHER_CONV
    );
    expect(await deals()).toHaveLength(0);
  });
  it('out-of-order message arrival uses timestamps, not insertion order, for registration and preview', async () => {
    await inbound(
      'wamid.newer',
      'customer',
      'text',
      'Newest',
      CONV,
      '2026-09-18T10:00:00Z'
    );
    await inbound(
      'wamid.older',
      'customer',
      'text',
      'Oldest',
      CONV,
      '2026-09-16T10:00:00Z'
    );
    expect((await summaries())[0]).toMatchObject({
      last_message_text: 'Newest',
      first_inbound_at: new Date('2026-09-16T10:00:00Z'),
    });
  });
  it('anon cannot read card summaries', async () => {
    await db.exec('SET LOCAL ROLE anon');
    await expect(summaries()).rejects.toThrow('permission denied');
  });
  it('messages use same contact lock as manual deal creation/movement', async () => {
    const functions = (
      await db.query<{ prosrc: string }>(
        'SELECT prosrc FROM pg_proc WHERE proname IN ($1,$2)',
        ['lock_deal_contact_context', 'create_deal_on_whatsapp_inbound']
      )
    ).rows;
    expect(functions).toHaveLength(2);
    for (const fn of functions)
      expect(fn.prosrc).toContain(
        'pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('
      );
  });
});
