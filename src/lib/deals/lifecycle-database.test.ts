import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
const QUALIFIED = '30000000-0000-4000-8000-000000000003';
const PURCHASE = '30000000-0000-4000-8000-000000000004';
const ATTRIBUTION = '40000000-0000-4000-8000-000000000001';
const HISTORICAL_EVENT = '50000000-0000-4000-8000-000000000001';
let db: PGlite;
let lost: string;
let historicalBefore: unknown;
const fetchSpy = vi.fn(() => {
  throw new Error('HTTP is forbidden in lifecycle tests');
});

type DealRow = {
  id: string;
  stage_id: string;
  status: string;
  title: string;
  lost_reason: string | null;
  lost_reason_notes: string | null;
  meta_attribution_id: string | null;
};
async function createDeal(stage?: string) {
  const result = await db.query<DealRow>(
    `INSERT INTO deals(account_id,user_id,pipeline_id,contact_id,stage_id,title)
    VALUES ($1,$1,$2,$3,$4,'Forged independent title') RETURNING *`,
    [ACCOUNT, PIPELINE, CONTACT, stage ?? null]
  );
  return result.rows[0];
}
async function currentDeal(id: string) {
  return (await db.query<DealRow>('SELECT * FROM deals WHERE id=$1', [id]))
    .rows[0];
}
async function move(
  id: string,
  target: string,
  reason?: string,
  notes?: string,
  account = ACCOUNT
) {
  return (
    await db.query<{
      result: {
        ok: boolean;
        error?: string;
        changed: boolean;
        conversionEventCreated: boolean;
        deal: DealRow;
      };
    }>(
      'SELECT move_deal_to_stage_with_conversion_intent($1,$2,$3,$4,$5) AS result',
      [account, id, target, reason ?? null, notes ?? null]
    )
  ).rows[0].result;
}
async function eventCount(deal?: string) {
  return Number(
    (
      await db.query<{ count: number }>(
        `SELECT count(*) FROM meta_conversion_events
    ${deal ? 'WHERE deal_id=$1' : ''}`,
        deal ? [deal] : []
      )
    ).rows[0].count
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    readFileSync(resolve('src/lib/deals/lifecycle-schema.fixture.sql'), 'utf8')
  );
  await db.exec(
    readFileSync(
      resolve('supabase/migrations/040_meta_conversions_foundation.sql'),
      'utf8'
    )
  );
  await db.exec(
    readFileSync(
      resolve('supabase/migrations/041_meta_conversion_stage_outbox.sql'),
      'utf8'
    )
  );
  await db.exec(`UPDATE pipeline_stages SET meta_conversion_event = CASE id
    WHEN '${LEAD}' THEN 'LeadSubmitted' WHEN '${QUALIFIED}' THEN 'QualifiedLead'
    WHEN '${PURCHASE}' THEN 'Purchase' ELSE NULL END;
    INSERT INTO meta_conversion_config(account_id,dataset_id,access_token,enabled)
      VALUES ('${ACCOUNT}','isolated-test-dataset','never-used-test-credential',true);
    INSERT INTO meta_ad_attributions(id,account_id,contact_id,ctwa_clid,waba_id)
      VALUES ('${ATTRIBUTION}','${ACCOUNT}','${CONTACT}','isolated-test-click','isolated-test-waba');
    INSERT INTO meta_conversion_events(id,account_id,event_name,event_id,event_time,status,attempts)
      VALUES ('${HISTORICAL_EVENT}','${ACCOUNT}','LeadSubmitted','historical',NOW(),'failed',1);`);
  historicalBefore = (await db.query('SELECT * FROM meta_conversion_events'))
    .rows;
  await db.exec(
    readFileSync(
      resolve(
        'supabase/migrations/20260917035905_deal_initial_stage_and_loss.sql'
      ),
      'utf8'
    )
  );
  lost = (
    await db.query<{ id: string }>(
      'SELECT id FROM pipeline_stages WHERE pipeline_id=$1 AND is_lost_stage',
      [PIPELINE]
    )
  ).rows[0].id;
}, 30000);
beforeEach(async () => {
  await db.exec('BEGIN');
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

describe('actual PostgreSQL deal lifecycle migration and central RPC', () => {
  it('executes the exact staging structural check and rolls back every fixture', async () => {
    await db.exec("UPDATE meta_conversion_config SET dataset_id='2000316380612611'");
    const before = (await db.query('SELECT * FROM pipelines ORDER BY id')).rows;
    const result = await db.exec(readFileSync(resolve('supabase/tests/20a_staging_structural_check.sql'),'utf8'));
    expect(result.at(-1)?.rows[0]).toMatchObject({result:{
      all_fixtures_rolled_back:true,new_conversion_events:0,historical_events_unchanged:true,
      first_normal_enforced:true,loss_confirm_atomic:true,reopening:true,
    }});
    expect((await db.query('SELECT * FROM pipelines ORDER BY id')).rows).toEqual(before);
  });
  it('backfills exactly one technical loss stage in every existing pipeline', async () => {
    const result = await db.query<{ count: number }>(
      'SELECT count(*) FROM pipeline_stages WHERE is_lost_stage GROUP BY pipeline_id'
    );
    expect(result.rows.map((row) => Number(row.count))).toEqual([1, 1]);
  });
  it('reuses an unequivocal existing loss stage instead of duplicating it', async () => {
    const result = await db.query<{ id: string }>(
      'SELECT id FROM pipeline_stages WHERE pipeline_id=$1 AND is_lost_stage',
      [OTHER_PIPELINE]
    );
    expect(result.rows[0].id).toBe('30000000-0000-4000-8000-000000000006');
  });
  it('preserves the entire historical event through migration', async () => {
    expect(
      (await db.query('SELECT * FROM meta_conversion_events')).rows
    ).toEqual(historicalBefore);
  });
  it('creates a loss stage automatically on server-side pipeline creation', async () => {
    const pipeline = (
      await db.query<{ id: string }>(
        `INSERT INTO pipelines(account_id,user_id,name) VALUES ($1,$1,'New') RETURNING id`,
        [ACCOUNT]
      )
    ).rows[0].id;
    const stages = (
      await db.query<{ is_lost_stage: boolean; meta_conversion_event: null }>(
        'SELECT * FROM pipeline_stages WHERE pipeline_id=$1',
        [pipeline]
      )
    ).rows;
    expect(stages).toHaveLength(1);
    expect(stages[0].is_lost_stage).toBe(true);
    expect(stages[0].meta_conversion_event).toBeNull();
  });
  it('rejects a duplicate loss stage', async () => {
    await expect(
      db.query(
        `INSERT INTO pipeline_stages(pipeline_id,name,is_lost_stage) VALUES ($1,'Duplicate',true)`,
        [PIPELINE]
      )
    ).rejects.toThrow('idx_pipeline_stages_one_lost');
  });
  it('cannot delete the sole loss stage but permits pipeline cascade deletion', async () => {
    await db.query('DELETE FROM pipeline_stages WHERE id=$1', [lost]);
    await expect(db.exec('SET CONSTRAINTS ALL IMMEDIATE')).rejects.toThrow(
      'pipeline_requires_one_lost_stage'
    );
  });
  it('allows deleting an entire empty pipeline', async () => {
    await db.query('DELETE FROM pipelines WHERE id=$1', [OTHER_PIPELINE]);
    await db.exec('SET CONSTRAINTS ALL IMMEDIATE');
    expect(
      (
        await db.query('SELECT id FROM pipeline_stages WHERE pipeline_id=$1', [
          OTHER_PIPELINE,
        ])
      ).rows
    ).toHaveLength(0);
  });
  it.each(['is_lost_stage=false', `pipeline_id='${OTHER_PIPELINE}'`])(
    'protects technical loss identity: %s',
    async (change) => {
      await expect(
        db.query(`UPDATE pipeline_stages SET ${change} WHERE id=$1`, [lost])
      ).rejects.toThrow('stage_identity_immutable');
    }
  );
  it.each(['LeadSubmitted', 'QualifiedLead', 'Purchase'])(
    'forbids %s mapping on loss',
    async (event) => {
      await expect(
        db.query(
          'UPDATE pipeline_stages SET meta_conversion_event=$1 WHERE id=$2',
          [event, lost]
        )
      ).rejects.toThrow('lost_stage_unmapped');
    }
  );
  it('keeps loss last after adding, reordering and explicitly repositioning stages', async () => {
    await db.query(
      `INSERT INTO pipeline_stages(pipeline_id,name,position) VALUES ($1,'Later',90)`,
      [PIPELINE]
    );
    await db.query('UPDATE pipeline_stages SET position=-100 WHERE id=$1', [
      lost,
    ]);
    const row = (
      await db.query<{ position: number; meta_conversion_event: null }>(
        'SELECT position,meta_conversion_event FROM pipeline_stages WHERE id=$1',
        [lost]
      )
    ).rows[0];
    expect(row.position).toBe(91);
    expect(row.meta_conversion_event).toBeNull();
  });
  it.each([
    undefined,
    LEAD,
    QUALIFIED,
    PURCHASE,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ])('forces first normal stage despite supplied stage %s', async (stage) => {
    expect((await createDeal(stage)).stage_id).toBe(INITIAL);
    expect(await eventCount()).toBe(1);
  });
  it('ignores a supplied loss stage during creation', async () => {
    expect((await createDeal(lost)).stage_id).toBe(INITIAL);
  });
  it('does not create intents even if initial stage has a mapping', async () => {
    await db.query(
      'UPDATE pipeline_stages SET meta_conversion_event=NULL WHERE id=$1',
      [LEAD]
    );
    await db.query(
      `UPDATE pipeline_stages SET meta_conversion_event='LeadSubmitted' WHERE id=$1`,
      [INITIAL]
    );
    const deal = await createDeal();
    expect(await eventCount(deal.id)).toBe(0);
  });
  it('chooses deterministic position/id order and excludes technical loss', async () => {
    await db.query('UPDATE pipeline_stages SET position=-20 WHERE id=$1', [
      QUALIFIED,
    ]);
    expect((await createDeal(lost)).stage_id).toBe(QUALIFIED);
  });
  it('rejects creation when pipeline has no normal stages', async () => {
    const pipeline = (
      await db.query<{ id: string }>(
        `INSERT INTO pipelines(account_id,user_id,name) VALUES ($1,$1,'Empty') RETURNING id`,
        [ACCOUNT]
      )
    ).rows[0].id;
    await expect(
      db.query(
        `INSERT INTO deals(account_id,user_id,pipeline_id,contact_id) VALUES ($1,$1,$2,$3)`,
        [ACCOUNT, pipeline, CONTACT]
      )
    ).rejects.toThrow('pipeline_has_no_normal_stage');
  });
  it('fills and protects title from contact name instead of client title', async () => {
    const deal = await createDeal();
    expect(deal.title).toBe('Current contact');
    await db.query(`UPDATE deals SET title='Forged' WHERE id=$1`, [deal.id]);
    expect((await currentDeal(deal.id)).title).toBe('Current contact');
  });
  it('requires a contact for new deals', async () => {
    await expect(
      db.query(
        `INSERT INTO deals(account_id,user_id,pipeline_id) VALUES ($1,$1,$2)`,
        [ACCOUNT, PIPELINE]
      )
    ).rejects.toThrow('contact_required');
  });
  it('rejects loss without reason before any mutation in the RPC', async () => {
    const deal = await createDeal();
    expect(await move(deal.id, lost)).toMatchObject({
      ok: false,
      error: 'lost_reason_required',
    });
    expect(await currentDeal(deal.id)).toEqual(deal);
  });
  it('rejects direct stage-write bypass without reason', async () => {
    const deal = await createDeal();
    await expect(
      db.query('UPDATE deals SET stage_id=$1 WHERE id=$2', [lost, deal.id])
    ).rejects.toThrow('lost_reason_required');
  });
  it('rejects direct status=lost without technical loss stage', async () => {
    const deal = await createDeal();
    await expect(
      db.query(
        `UPDATE deals SET status='lost',lost_reason='other' WHERE id=$1`,
        [deal.id]
      )
    ).rejects.toThrow('lost_status_requires_lost_stage');
  });
  it.each([
    'price',
    'no_interest',
    'no_budget',
    'no_response',
    'competitor',
    'unavailable',
    'bad_timing',
    'unqualified',
    'other',
  ])(
    'atomically persists loss with reason %s without any conversion',
    async (reason) => {
      const deal = await createDeal();
      const result = await move(deal.id, lost, reason, 'Optional note');
      expect(result).toMatchObject({
        ok: true,
        conversionEventCreated: false,
        deal: {
          stage_id: lost,
          status: 'lost',
          lost_reason: reason,
          lost_reason_notes: 'Optional note',
        },
      });
      expect(await eventCount(deal.id)).toBe(0);
    }
  );
  it('rejects unknown reason code and excessive notes', async () => {
    const deal = await createDeal();
    expect(await move(deal.id, lost, 'unknown')).toMatchObject({
      ok: false,
      error: 'lost_reason_required',
    });
    expect(await move(deal.id, lost, 'other', 'x'.repeat(4001))).toMatchObject({
      ok: false,
      error: 'invalid_loss_notes',
    });
  });
  it('supports optional notes for other', async () => {
    const deal = await createDeal();
    await move(deal.id, lost, 'other');
    expect((await currentDeal(deal.id)).lost_reason_notes).toBeNull();
  });
  it('edits reason on the same loss stage without creating conversions', async () => {
    const deal = await createDeal();
    await move(deal.id, lost, 'price');
    expect(await move(deal.id, lost, 'other', 'Updated')).toMatchObject({
      ok: true,
      changed: false,
      deal: { lost_reason: 'other', lost_reason_notes: 'Updated' },
    });
    expect(await eventCount(deal.id)).toBe(0);
  });
  it('reopens to open and preserves historical reason and frozen attribution', async () => {
    const deal = await createDeal();
    await db.query('UPDATE deals SET meta_attribution_id=$1 WHERE id=$2', [
      ATTRIBUTION,
      deal.id,
    ]);
    await move(deal.id, lost, 'price', 'History');
    await move(deal.id, INITIAL);
    expect(await currentDeal(deal.id)).toMatchObject({
      status: 'open',
      stage_id: INITIAL,
      lost_reason: 'price',
      lost_reason_notes: 'History',
      meta_attribution_id: ATTRIBUTION,
    });
    expect(await eventCount(deal.id)).toBe(0);
  });
  it.each([
    [LEAD, 'LeadSubmitted'],
    [QUALIFIED, 'QualifiedLead'],
    [PURCHASE, 'Purchase'],
  ])(
    'preserves existing conversion semantics and dedupe for %s',
    async (stage, event) => {
      const deal = await createDeal();
      await move(deal.id, stage);
      await db.query(
        `UPDATE meta_conversion_events SET status='sent',attempts=1 WHERE deal_id=$1`,
        [deal.id]
      );
      const events = (
        await db.query(
          'SELECT * FROM meta_conversion_events WHERE deal_id=$1',
          [deal.id]
        )
      ).rows;
      await move(deal.id, lost, 'no_interest');
      await move(deal.id, stage);
      expect(
        (
          await db.query(
            'SELECT * FROM meta_conversion_events WHERE deal_id=$1',
            [deal.id]
          )
        ).rows
      ).toEqual(events);
      expect(await eventCount(deal.id)).toBe(1);
      expect(events[0]).toMatchObject({
        event_name: event,
        event_id: `meta:${ACCOUNT}:${deal.id}:${event}`,
        value: event === 'Purchase' ? '0.00' : null,
        currency: event === 'Purchase' ? 'BRL' : null,
      });
      expect((await currentDeal(deal.id)).meta_attribution_id).toBe(
        ATTRIBUTION
      );
    }
  );
  it('preserves won semantics on normal stages', async () => {
    const deal = await createDeal();
    await db.query(`UPDATE deals SET status='won' WHERE id=$1`, [deal.id]);
    await move(deal.id, LEAD);
    expect((await currentDeal(deal.id)).status).toBe('won');
  });
  it('rejects cross-tenant and cross-pipeline loss targets', async () => {
    const deal = await createDeal();
    expect(await move(deal.id, lost, 'other', undefined, OTHER)).toMatchObject({
      ok: false,
      error: 'deal_not_found',
    });
    const otherLost = (
      await db.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE pipeline_id=$1 AND is_lost_stage',
        [OTHER_PIPELINE]
      )
    ).rows[0].id;
    expect(await move(deal.id, otherLost, 'other')).toMatchObject({
      ok: false,
      error: 'stage_not_available',
    });
  });
  it('rejects cross-tenant contact on service-role creation', async () => {
    await expect(
      db.query(
        `INSERT INTO deals(account_id,user_id,pipeline_id,contact_id) VALUES ($1,$1,$2,'10000000-0000-4000-8000-000000000002')`,
        [ACCOUNT, PIPELINE]
      )
    ).rejects.toThrow('contact_not_available');
  });
  it('rejects moving an existing deal into another pipeline or tenant', async () => {
    const deal = await createDeal();
    await expect(
      db.query('UPDATE deals SET account_id=$1,pipeline_id=$2 WHERE id=$3', [
        OTHER,
        OTHER_PIPELINE,
        deal.id,
      ])
    ).rejects.toThrow('deal_identity_immutable');
  });
  it.each(['agent', 'admin', 'owner'])(
    'allows %s creation under RLS and forces initial stage',
    async (role) => {
      await db.exec(
        `SET LOCAL test.account='${ACCOUNT}'; SET LOCAL test.member_role='${role}'; SET LOCAL ROLE authenticated;`
      );
      expect((await createDeal(PURCHASE)).stage_id).toBe(INITIAL);
      expect(
        (await db.query('SELECT * FROM deals WHERE account_id=$1', [OTHER]))
          .rows
      ).toHaveLength(0);
    }
  );
  it('rejects viewer creation under existing role policies', async () => {
    await db.exec(
      `SET LOCAL test.account='${ACCOUNT}'; SET LOCAL test.member_role='viewer'; SET LOCAL ROLE authenticated;`
    );
    await expect(createDeal()).rejects.toThrow('row-level security');
  });
  it('blocks direct authenticated stage writes that bypass the central route', async () => {
    const deal = await createDeal();
    await db.exec(`SET LOCAL test.account='${ACCOUNT}'; SET LOCAL test.member_role='agent'; SET LOCAL ROLE authenticated;`);
    await expect(db.query('UPDATE deals SET stage_id=$1 WHERE id=$2',[LEAD,deal.id])).rejects.toThrow('stage_move_requires_central_rpc');
  });
  it.each(['agent', 'admin', 'owner'])(
    'keeps privileged movement RPC unavailable to browser %s role',
    async (role) => {
      await db.exec(
        `SET LOCAL test.account='${ACCOUNT}'; SET LOCAL test.member_role='${role}'; SET LOCAL ROLE authenticated;`
      );
      await expect(
        move('60000000-0000-4000-8000-000000000001', lost, 'other')
      ).rejects.toThrow('permission denied');
    }
  );
  it.each(['admin', 'owner'])(
    'allows %s pipeline creation plus auto stage under RLS',
    async (role) => {
      await db.exec(
        `SET LOCAL test.account='${ACCOUNT}'; SET LOCAL test.member_role='${role}'; SET LOCAL ROLE authenticated;`
      );
      const row = (
        await db.query<{ id: string }>(
          `INSERT INTO pipelines(account_id,user_id,name) VALUES ($1,$1,'RLS new') RETURNING id`,
          [ACCOUNT]
        )
      ).rows[0];
      expect(
        (
          await db.query('SELECT * FROM pipeline_stages WHERE pipeline_id=$1', [
            row.id,
          ])
        ).rows
      ).toHaveLength(1);
      await db.exec('SET CONSTRAINTS ALL IMMEDIATE');
    }
  );
});
