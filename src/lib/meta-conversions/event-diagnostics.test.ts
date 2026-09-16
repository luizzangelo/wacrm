import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_STATUSES } from './event-diagnostics-types';
import {
  listEventDiagnostics,
  parseDiagnosticFilters,
  serializeEventDiagnostic,
} from './event-diagnostics';

const account = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';
const dealId = '44444444-4444-4444-8444-444444444444';
const attributionId = '55555555-5555-4555-8555-555555555555';
const contactId = '66666666-6666-4666-8666-666666666666';
const pipelineId = '77777777-7777-4777-8777-777777777777';
const stageId = '88888888-8888-4888-8888-888888888888';
const row = (extra: Record<string, unknown> = {}) => ({
  id: eventId,
  account_id: account,
  deal_id: dealId,
  attribution_id: attributionId,
  event_name: 'Purchase',
  status: 'failed',
  attempts: 1,
  event_id: `meta:${account}:${dealId}:Purchase`,
  event_time: '2026-09-16T10:00:00Z',
  created_at: '2026-09-16T10:00:00Z',
  updated_at: '2026-09-16T10:00:10Z',
  sent_at: null,
  meta_http_status: 400,
  value: 150,
  currency: 'BRL',
  meta_response: { error: { code: 100, error_subcode: 2804132 } },
  ...extra,
});

// Implements actual filtering/order/range over fixtures, and records SQL builder predicates.
function database(events = [row()]) {
  const tables: Record<string, Record<string, unknown>[]> = {
    meta_conversion_events: [
      ...events,
      row({ account_id: other, status: 'pending' }),
    ],
    meta_conversion_config: [
      { account_id: account, dataset_id: '2000316380612611' },
    ],
    meta_ad_attributions: [
      { account_id: account, id: attributionId, contact_id: contactId },
    ],
    deals: [
      {
        account_id: account,
        id: dealId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        value: 9999,
      },
    ],
    contacts: [{ account_id: account, id: contactId }],
    pipelines: [
      { account_id: account, id: pipelineId, name: 'TESTE META CAPI' },
    ],
    pipeline_stages: [{ id: stageId, pipeline_id: pipelineId, name: 'Compra' }],
  };
  const calls: {
    table: string;
    predicates: [string, unknown][];
    columns: string;
    head: boolean;
    range?: number[];
  }[] = [];
  const client = {
    from(table: string) {
      const call = {
        table,
        predicates: [] as [string, unknown][],
        columns: '',
        head: false,
        range: undefined as number[] | undefined,
      };
      calls.push(call);
      let data = [...tables[table]];
      let start = 0;
      let end = Infinity;
      let single = false;
      const orders: { column: string; ascending: boolean }[] = [];
      const builder = {
        select(columns: string, options?: { head?: boolean }) {
          call.columns = columns;
          call.head = !!options?.head;
          return builder;
        },
        eq(key: string, value: unknown) {
          call.predicates.push([key, value]);
          data = data.filter((r) => r[key] === value);
          return builder;
        },
        in(key: string, values: unknown[]) {
          call.predicates.push([key, values]);
          data = data.filter((r) => values.includes(r[key]));
          return builder;
        },
        gte(key: string, value: string) {
          data = data.filter((r) => String(r[key]) >= value);
          return builder;
        },
        lt(key: string, value: string) {
          data = data.filter((r) => String(r[key]) < value);
          return builder;
        },
        order(column: string, options: { ascending: boolean }) {
          orders.push({ column, ascending: options.ascending });
          return builder;
        },
        range(from: number, to: number) {
          start = from;
          end = to;
          call.range = [from, to];
          return builder;
        },
        maybeSingle() {
          single = true;
          return builder;
        },
        then(resolve: (value: unknown) => unknown) {
          data.sort((a, b) => {
            for (const o of orders) {
              const order = String(a[o.column]).localeCompare(
                String(b[o.column])
              );
              if (order) return o.ascending ? order : -order;
            }
            return 0;
          });
          return Promise.resolve({
            data: call.head
              ? null
              : single
                ? (data[0] ?? null)
                : data.slice(start, end + 1),
            count: data.length,
            error: null,
          }).then(resolve);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls, tables };
}

describe('diagnostic filters', () => {
  it('defaults to bounded server-side pagination', () =>
    expect(parseDiagnosticFilters(new URLSearchParams())).toMatchObject({
      page: 1,
      pageSize: 20,
    }));
  it.each([
    'page=0',
    'page_size=51',
    'page=1.5',
    'page=100001',
    'status=retry',
    'event_name=bad',
    'from=2026-02-30',
    'from=bad',
    'from=2026-09-17&to=2026-09-16',
  ])('rejects invalid input %s', (input) =>
    expect(() => parseDiagnosticFilters(new URLSearchParams(input))).toThrow()
  );
  it('uses inclusive UTC calendar dates and exclusive upper bound', () =>
    expect(
      parseDiagnosticFilters(
        new URLSearchParams('from=2026-09-16&to=2026-09-16')
      )
    ).toMatchObject({
      from: '2026-09-16T00:00:00.000Z',
      until: '2026-09-17T00:00:00.000Z',
    }));
});

describe('safe serializer', () => {
  it('masks only structurally valid internal event IDs and never returns them whole', () => {
    const result = serializeEventDiagnostic(row());
    expect(result.event_id_masked).toBe('meta:11111111…:44444444…:Purchase');
    expect(result.event_id_masked).not.toContain(dealId);
    expect(result.event_id_masked).not.toContain(account);
  });
  const secrets = [
    'EAATestSecretToken',
    'Bearer AUTH_SECRET',
    'CTWA_COMPLETE_ORIGINAL',
    'private@example.test',
    '5585999991234',
    'Private Customer Full Name',
    'a'.repeat(64),
    'CRON_PRIVATE_SECRET',
  ];
  it.each(['failed', 'delivery_unknown'])(
    'never leaks fixture secrets/PII/hashes for %s',
    (status) => {
      const unsafe = secrets.join(' ');
      const serialized = serializeEventDiagnostic(
        row({
          status,
          event_id: unsafe,
          error_message: unsafe,
          access_token: secrets[0],
          Authorization: secrets[1],
          ctwa_clid: secrets[2],
          email: secrets[3],
          phone: secrets[4],
          name: secrets[5],
          ph: [secrets[6]],
          cron_secret: secrets[7],
          meta_response: {
            error: {
              code: 100,
              error_subcode: 2804132,
              message: unsafe,
              error_data: { details: unsafe },
            },
            messages: [unsafe],
            payload: unsafe,
          },
        })
      );
      const text = JSON.stringify(serialized);
      for (const secret of secrets) expect(text).not.toContain(secret);
      expect(serialized).toMatchObject({
        http_status: 400,
        meta_error_code: 100,
        meta_error_subcode: 2804132,
      });
      expect(serialized).not.toHaveProperty('meta_response');
      expect(serialized).not.toHaveProperty('event_id');
    }
  );
  it('only emits numeric error codes, canonical timestamps and valid IDs', () => {
    const result = serializeEventDiagnostic(
      row({
        id: secrets[0],
        attempts: -1,
        event_time: secrets[3],
        meta_http_status: secrets[4],
        meta_response: {
          error: { code: secrets[0], error_subcode: secrets[6] },
        },
      }),
      { contactId: secrets[3], dealId: secrets[5] }
    );
    expect(result).toMatchObject({
      id: null,
      attempts: 0,
      event_time: null,
      http_status: null,
      meta_error_code: null,
      meta_error_subcode: null,
      contact_id: null,
      deal_id: null,
    });
  });
  it('retains Purchase snapshot only, not arbitrary custom_data', () => {
    expect(
      serializeEventDiagnostic(row({ custom_data: { value: 999 } })).purchase
    ).toEqual({ value: 150, currency: 'BRL' });
    expect(
      serializeEventDiagnostic(row({ event_name: 'LeadSubmitted' })).purchase
    ).toBeNull();
  });
  it('diagnoses stale sending without mutating the row', () => {
    const input = row({ status: 'sending' });
    const before = JSON.stringify(input);
    const result = serializeEventDiagnostic(
      input,
      {},
      Date.parse('2026-09-16T10:01:10Z')
    );
    expect(result).toMatchObject({
      sending_stale: true,
      sending_age_seconds: 60,
      status: 'sending',
      attempts: 1,
    });
    expect(JSON.stringify(input)).toBe(before);
  });
  it('explains worker-crash unknown using closed vocabulary', () =>
    expect(
      serializeEventDiagnostic(
        row({
          status: 'delivery_unknown',
          error_message: 'delivery_unknown_worker_crash',
        })
      ).diagnostic_message
    ).toContain('worker'));
});

describe('read-only tenant repository', () => {
  it('scopes every origin query to the caller account, and stages to readable pipelines', async () => {
    const db = database();
    const result = await listEventDiagnostics(db.client, account, {
      page: 1,
      pageSize: 20,
    });
    expect(result.events).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.counts.pending).toBe(0);
    expect(result.counts.failed).toBe(1);
    for (const call of db.calls) {
      if (call.table === 'pipeline_stages')
        expect(call.predicates).toContainEqual(['pipeline_id', [pipelineId]]);
      else expect(call.predicates).toContainEqual(['account_id', account]);
    }
    expect(db.calls.find((c) => c.table === 'contacts')?.columns).toBe('id');
    expect(
      db.calls.find((c) => c.table === 'meta_conversion_config')?.columns
    ).toBe('dataset_id');
    expect(result.events[0]).toMatchObject({
      contact_id: contactId,
      deal_id: dealId,
      pipeline: 'TESTE META CAPI',
      stage: 'Compra',
      attribution_present: true,
    });
  });
  it('supports NULL/deleted deal with attribution contact still available', async () => {
    const db = database([row({ deal_id: null })]);
    const result = await listEventDiagnostics(db.client, account, {
      page: 1,
      pageSize: 20,
    });
    expect(result.events[0]).toMatchObject({
      deal_id: null,
      contact_id: contactId,
      pipeline: null,
      stage: null,
      purchase: { value: 150, currency: 'BRL' },
    });
  });
  it('ignores forged event contact_id and resolves through frozen attribution', async () => {
    const db = database([row({ contact_id: other })]);
    const result = await listEventDiagnostics(db.client, account, {
      page: 1,
      pageSize: 20,
    });
    expect(result.events[0].contact_id).toBe(contactId);
  });
  it('orders recent first, breaks ties by id and pages on the server', async () => {
    const db = database([
      row({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        created_at: '2026-09-17T10:00:00Z',
      }),
      row(),
      row({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
    ]);
    const result = await listEventDiagnostics(db.client, account, {
      page: 2,
      pageSize: 1,
    });
    expect(result.total).toBe(3);
    expect(result.events[0].id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(db.calls[0].range).toEqual([1, 1]);
  });
  it.each(DIAGNOSTIC_STATUSES)(
    'filters %s without filtering account-wide counters',
    async (status) => {
      const db = database([
        row(),
        row({ status, event_name: 'QualifiedLead' }),
      ]);
      const result = await listEventDiagnostics(db.client, account, {
        page: 1,
        pageSize: 20,
        status,
        eventName: 'QualifiedLead',
      });
      expect(result.total).toBe(1);
      expect(result.events[0]).toMatchObject({
        status,
        event_name: 'QualifiedLead',
      });
      expect(result.counts.failed).toBe(status === 'failed' ? 2 : 1);
    }
  );
  it('filters period on created_at, not event_time', async () => {
    const db = database([
      row(),
      row({
        created_at: '2026-09-17T00:00:00Z',
        event_time: '2026-09-16T10:00:00Z',
      }),
    ]);
    const result = await listEventDiagnostics(
      db.client,
      account,
      parseDiagnosticFilters(
        new URLSearchParams('from=2026-09-16&to=2026-09-16')
      )
    );
    expect(result.total).toBe(1);
  });
  it('renders empty pages safely', async () => {
    const db = database();
    const result = await listEventDiagnostics(db.client, account, {
      page: 2,
      pageSize: 20,
    });
    expect(result.events).toEqual([]);
    expect(result.total).toBe(1);
  });
});
