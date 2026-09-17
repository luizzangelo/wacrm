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
import { LOST_REASONS } from '@/lib/deals/lifecycle';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const P = '20000000-0000-4000-8000-000000000001';
const INITIAL = '30000000-0000-4000-8000-000000000001';
const C = '60000000-0000-4000-8000-000000000001';
const OTHER_C = '60000000-0000-4000-8000-000000000002';
const NOW = '2026-09-17T15:00:00Z';
let db: PGlite;
let deal: string;
let lost: string;
const noFetch = vi.fn(() => {
  throw new Error('No HTTP in dashboard tests');
});
beforeAll(async () => {
  db = new PGlite();
  for (const path of [
    'src/lib/deals/lifecycle-schema.fixture.sql',
    'src/lib/deals/inbound-schema.fixture.sql',
    'supabase/migrations/040_meta_conversions_foundation.sql',
    'supabase/migrations/041_meta_conversion_stage_outbox.sql',
    'supabase/migrations/20260917035905_deal_initial_stage_and_loss.sql',
    'supabase/migrations/20260917054725_dashboard_loss_history_and_response_metrics.sql',
  ])
    await db.exec(readFileSync(path, 'utf8'));
}, 30000);
beforeEach(async () => {
  await db.exec('BEGIN; SET LOCAL ROLE service_role');
  vi.stubGlobal('fetch', noFetch);
  deal = (
    await db.query<{ id: string }>(
      `INSERT INTO deals(account_id,user_id,pipeline_id,stage_id,title,contact_id)
    VALUES($1,$1,$2,$3,'Fixture','10000000-0000-4000-8000-000000000001') RETURNING id`,
      [A, P, INITIAL]
    )
  ).rows[0].id;
  lost = (
    await db.query<{ id: string }>(
      'SELECT id FROM pipeline_stages WHERE pipeline_id=$1 AND is_lost_stage',
      [P]
    )
  ).rows[0].id;
});
afterEach(async () => {
  expect(noFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  await db.exec('ROLLBACK');
});
afterAll(async () => {
  await db.close();
});
async function move(stage: string, reason: string | null = null) {
  return (
    await db.query<{ result: unknown }>(
      'SELECT move_deal_to_stage_with_conversion_intent($1,$2,$3,$4) result',
      [A, deal, stage, reason]
    )
  ).rows[0].result;
}
async function losses() {
  return (
    await db.query<{
      lost_reason: string;
      lost_at: string;
      account_id: string;
    }>('SELECT * FROM deal_loss_events ORDER BY lost_at,id')
  ).rows;
}
async function occurrence(at: string, reason = 'price', account = A) {
  await db.query(
    'INSERT INTO deal_loss_events(account_id,deal_id,pipeline_id,lost_stage_id,lost_reason,lost_at) VALUES($1,$2,$3,$4,$5,$6)',
    [account, deal, P, lost, reason, at]
  );
}
async function counts(
  period = 'month',
  account = A,
  now = NOW,
  timezone = 'America/Fortaleza'
) {
  return (
    await db.query<{ reason: string; count: number }>(
      'SELECT * FROM dashboard_loss_reasons($1,$2,$3,$4)',
      [account, period, timezone, now]
    )
  ).rows;
}
async function message(
  sender: string,
  time: string,
  options: { status?: string; type?: string; conv?: string } = {}
) {
  await db.query(
    'INSERT INTO messages(conversation_id,sender_type,created_at,status,content_type) VALUES($1,$2,$3,$4,$5)',
    [
      options.conv ?? C,
      sender,
      time,
      options.status ?? 'delivered',
      options.type ?? 'text',
    ]
  );
}
async function pair(time: string, minutes: number, conv = C) {
  await message('customer', time, { conv });
  await message(
    'agent',
    new Date(new Date(time).getTime() + minutes * 60000).toISOString(),
    { conv }
  );
}
async function response(
  account = A,
  now = NOW,
  timezone = 'America/Fortaleza'
) {
  return (
    await db.query<{
      dow: number;
      avg_minutes: number | null;
      samples: number;
      this_week_avg: number | null;
      last_week_avg: number | null;
    }>('SELECT * FROM dashboard_response_time($1,$2,$3)', [
      account,
      timezone,
      now,
    ])
  ).rows;
}
describe('transactional immutable loss history', () => {
  it('does not backfill existing deals or count open deals with historical reasons', async () => {
    expect(await losses()).toEqual([]);
    expect((await counts()).every((r) => r.count === 0)).toBe(true);
  });
  it('records one real loss with account/deal/pipeline/stage/reason and a real timestamp', async () => {
    await move(lost, 'price');
    expect(await losses()).toMatchObject([
      {
        account_id: A,
        deal_id: deal,
        pipeline_id: P,
        lost_stage_id: lost,
        lost_reason: 'price',
      },
    ]);
    expect(
      new Date((await losses())[0].lost_at as string).getTime()
    ).toBeGreaterThan(0);
  });
  it('retry and same-stage reason edit never duplicate or mutate the original occurrence', async () => {
    await move(lost, 'price');
    const before = await losses();
    await move(lost, 'price');
    await move(lost, 'other');
    expect(await losses()).toEqual(before);
  });
  it('reopen preserves loss and a second real loss records a second occurrence', async () => {
    await move(lost, 'price');
    await move(INITIAL);
    expect(await losses()).toHaveLength(1);
    await move(lost, 'no_budget');
    expect((await losses()).map((r) => r.lost_reason)).toEqual([
      'price',
      'no_budget',
    ]);
  });
  it('loss insert rolls back together with the stage mutation', async () => {
    await db.exec('SAVEPOINT loss_check');
    await move(lost, 'price');
    await db.exec('ROLLBACK TO SAVEPOINT loss_check');
    expect(await losses()).toEqual([]);
    expect(
      (
        await db.query<{ stage_id: string }>(
          'SELECT stage_id FROM deals WHERE id=$1',
          [deal]
        )
      ).rows[0].stage_id
    ).toBe(INITIAL);
  });
  it('invalid reason fails before either stage or history writes', async () => {
    await db.exec('SAVEPOINT invalid_reason');
    expect(await move(lost, 'unknown')).toMatchObject({
      error: 'lost_reason_required',
    });
    await db.exec('ROLLBACK TO SAVEPOINT invalid_reason');
    expect(await losses()).toEqual([]);
  });
  it('history survives deletion of the deal (IDs are immutable snapshots)', async () => {
    await move(lost, 'other');
    await db.query('DELETE FROM deals WHERE id=$1', [deal]);
    expect(await losses()).toHaveLength(1);
  });
  it('never creates conversion intents for loss/reopen', async () => {
    await move(lost, 'other');
    await move(INITIAL);
    await move(lost, 'price');
    expect(
      (await db.query('SELECT * FROM meta_conversion_events')).rows
    ).toEqual([]);
  });
  it('browser roles cannot forge, edit or delete loss occurrences', async () => {
    const result = await db.query<{
      insert: boolean;
      update: boolean;
      delete: boolean;
      anon: boolean;
    }>(`SELECT
      has_table_privilege('authenticated','deal_loss_events','INSERT') AS insert,
      has_table_privilege('authenticated','deal_loss_events','UPDATE') AS update,
      has_table_privilege('authenticated','deal_loss_events','DELETE') AS delete,
      has_table_privilege('anon','deal_loss_events','SELECT') AS anon`);
    expect(result.rows[0]).toEqual({
      insert: false,
      update: false,
      delete: false,
      anon: false,
    });
  });
});
describe('loss aggregates: calendar periods, timezone and RLS', () => {
  beforeEach(async () => {
    for (const at of [
      '2026-08-31T23:00Z',
      '2026-09-01T03:00Z',
      '2026-09-13T02:59:59Z',
      '2026-09-13T03:00Z',
      '2026-09-17T02:59:59Z',
      '2026-09-17T03:00Z',
      '2026-09-17T16:00Z',
    ])
      await occurrence(at);
    await occurrence('2026-09-17T04:00Z', 'other', B);
  });
  it.each([
    ['day', 1],
    ['week', 3],
    ['month', 5],
  ])(
    '%s includes exact local boundary and excludes future/outside/account data',
    async (period, count) => {
      expect(
        (await counts(period as string)).find((r) => r.reason === 'price')
          ?.count
      ).toBe(count);
    }
  );
  it('always returns all nine valid codes in fixed order including zeros, with no PII', async () => {
    const rows = await counts();
    expect(rows.map((r) => r.reason)).toEqual(LOST_REASONS);
    expect(rows.slice(1).every((r) => r.count === 0)).toBe(true);
    expect(
      rows.every((r) => Object.keys(r).sort().join(',') === 'count,reason')
    ).toBe(true);
  });
  it('Sunday 00:00 local starts a new week (not Monday)', async () => {
    expect((await counts('week', A, '2026-09-13T03:00Z'))[0].count).toBe(1);
  });
  it('UTC-3 midnight is not UTC midnight', async () => {
    expect((await counts('day', A, '2026-09-17T02:59:59Z'))[0].count).toBe(1);
  });
  it('different valid timezone uses its own calendar boundary', async () => {
    expect((await counts('day', A, NOW, 'UTC'))[0].count).toBe(2);
  });
  it('authenticated member cannot aggregate or read the other account', async () => {
    await db.exec(
      `SET LOCAL ROLE authenticated; SET LOCAL test.account='${A}'; SET LOCAL test.member_role='viewer'`
    );
    expect((await counts('month', B)).every((r) => r.count === 0)).toBe(true);
    expect((await losses()).every((r) => r.account_id === A)).toBe(true);
    expect((await counts('month'))[0].count).toBe(5);
  });
  it('invalid periods fail clearly', async () => {
    await expect(counts('year')).rejects.toThrow('invalid dashboard period');
  });
  it('invalid timezone fails clearly', async () => {
    await expect(counts('day', A, NOW, 'invalid')).rejects.toThrow(
      'invalid timezone'
    );
  });
  it('invalid reason cannot enter history', async () => {
    await expect(occurrence(NOW, 'invalid')).rejects.toThrow();
  });
});
describe('first response: complete bursts, weighted weeks, Sunday-first', () => {
  it('empty week has seven null buckets and null summaries', async () => {
    const rows = await response();
    expect(rows.map((r) => r.dow)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(
      rows.every(
        (r) =>
          r.avg_minutes === null &&
          r.samples === 0 &&
          r.this_week_avg === null &&
          r.last_week_avg === null
      )
    ).toBe(true);
  });
  it('daily values remain on correct Sunday-first positions and weighted summary uses same minutes', async () => {
    await pair('2026-09-13T04:00Z', 100);
    await pair('2026-09-14T04:00Z', 1);
    await pair('2026-09-14T05:00Z', 9);
    const rows = await response();
    expect(rows[0]).toMatchObject({ dow: 0, avg_minutes: 100, samples: 1 });
    expect(rows[1]).toMatchObject({ dow: 1, avg_minutes: 5, samples: 2 });
    expect(rows[0].this_week_avg).toBeCloseTo(110 / 3);
  });
  it('previous week uses same metric/unit and does not pollute current bars', async () => {
    await pair('2026-09-06T04:00Z', 624);
    await pair('2026-09-13T04:00Z', 5);
    const rows = await response();
    expect(rows[0]).toMatchObject({
      avg_minutes: 5,
      this_week_avg: 5,
      last_week_avg: 624,
    });
  });
  it('multiple inbound messages are one observation beginning at first unanswered inbound', async () => {
    await message('customer', '2026-09-13T04:00Z');
    await message('customer', '2026-09-13T04:03Z');
    await message('agent', '2026-09-13T04:05Z');
    await message('agent', '2026-09-13T04:06Z');
    expect((await response())[0]).toMatchObject({ avg_minutes: 5, samples: 1 });
  });
  it('failed/unsent outbound and reactions do not answer a customer', async () => {
    await message('customer', '2026-09-13T04:00Z');
    await message('agent', '2026-09-13T04:01Z', { status: 'failed' });
    await message('agent', '2026-09-13T04:02Z', { status: 'pending' });
    await message('agent', '2026-09-13T04:03Z', { type: 'reaction' });
    await message('agent', '2026-09-13T04:10Z');
    expect((await response())[0].avg_minutes).toBe(10);
  });
  it('successful bot response counts, preserving existing business definition', async () => {
    await message('customer', '2026-09-13T04:00Z');
    await message('bot', '2026-09-13T04:05Z', { status: 'sent' });
    expect((await response())[0]).toMatchObject({ avg_minutes: 5, samples: 1 });
  });
  it('system/reaction inbound does not create an observation', async () => {
    await message('customer', '2026-09-13T04:00Z', { type: 'system' });
    await message('customer', '2026-09-13T04:01Z', { type: 'reaction' });
    await message('agent', '2026-09-13T04:05Z');
    expect((await response())[0].samples).toBe(0);
  });
  it('does not clip a pending burst at the query window start', async () => {
    await message('customer', '2026-09-05T04:00Z');
    await message('customer', '2026-09-06T04:00Z');
    await message('agent', '2026-09-06T04:05Z');
    expect((await response())[0].last_week_avg).toBeNull();
  });
  it('timezone assigns Saturday 23:59 local to previous week even though UTC is Sunday', async () => {
    await pair('2026-09-13T02:59Z', 1);
    const rows = await response();
    expect(rows[0].last_week_avg).toBe(1);
    expect(rows[0].this_week_avg).toBeNull();
  });
  it('unanswered inbound and future responses never count', async () => {
    await pair('2026-09-17T14:59Z', 10);
    expect((await response())[4].samples).toBe(0);
  });
  it('tenant isolation applies to series and summaries, not only UI', async () => {
    await pair('2026-09-13T04:00Z', 5);
    await pair('2026-09-13T04:00Z', 100, OTHER_C);
    await db.exec(
      `SET LOCAL ROLE authenticated; SET LOCAL test.account='${A}'; SET LOCAL test.member_role='viewer'`
    );
    expect((await response())[0].avg_minutes).toBe(5);
    expect(
      (await response(B)).every(
        (r) => r.samples === 0 && r.this_week_avg === null
      )
    ).toBe(true);
  });
  it('zero-duration observations are valid and distinct from no data', async () => {
    await db.exec(`INSERT INTO messages(id,conversation_id,sender_type,created_at,status) VALUES
      ('70000000-0000-4000-8000-000000000001','${C}','customer','2026-09-13T04:00Z','delivered'),
      ('70000000-0000-4000-8000-000000000002','${C}','agent','2026-09-13T04:00Z','sent')`);
    expect((await response())[0]).toMatchObject({
      avg_minutes: 0,
      samples: 1,
      this_week_avg: 0,
    });
  });
  it('server aggregates more than 1000 messages without the Data API row cap truncating pairs', async () => {
    await db.exec(`INSERT INTO messages(conversation_id,sender_type,created_at,status)
      SELECT '${C}','customer','2026-09-13T04:00Z'::timestamptz+i*interval '1 second','delivered' FROM generate_series(0,1001) i`);
    await message('agent', '2026-09-13T05:00Z');
    expect((await response())[0]).toMatchObject({
      avg_minutes: 60,
      samples: 1,
    });
  });
  it('response aggregates contain no customer data or message identifiers', async () => {
    expect(Object.keys((await response())[0]).sort()).toEqual([
      'avg_minutes',
      'dow',
      'last_week_avg',
      'samples',
      'this_week_avg',
    ]);
  });
});
