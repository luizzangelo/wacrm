import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  getDealMetaAttribution,
  getLatestContactMetaAttribution,
  MetaAttributionViewReadError,
  type MetaAdAttributionView,
} from './attribution-view';

function attribution(
  id: string,
  accountId: string,
  contactId: string,
  receivedAt: string
): MetaAdAttributionView {
  return {
    id,
    account_id: accountId,
    contact_id: contactId,
    ad_id: `ad-${id}`,
    ad_name: `Ad ${id}`,
    adset_id: `adset-${id}`,
    adset_name: `Ad set ${id}`,
    campaign_id: `campaign-${id}`,
    campaign_name: `Campaign ${id}`,
    enrichment_status: 'enriched',
    received_at: receivedAt,
  };
}

function attributionDb(
  rows: MetaAdAttributionView[],
  failure?: { code: string; message: string }
) {
  const calls: { method: string; args: unknown[] }[] = [];
  const db = {
    from(table: string) {
      calls.push({ method: 'from', args: [table] });
      let result = [...rows];
      let limit: number | null = null;
      const query = {
        select(...args: unknown[]) {
          calls.push({ method: 'select', args });
          return query;
        },
        eq(column: keyof MetaAdAttributionView, value: unknown) {
          calls.push({ method: 'eq', args: [column, value] });
          result = result.filter((row) => row[column] === value);
          return query;
        },
        order(
          column: keyof MetaAdAttributionView,
          options: { ascending: boolean }
        ) {
          calls.push({ method: 'order', args: [column, options] });
          result.sort((a, b) => {
            const comparison = String(a[column]).localeCompare(
              String(b[column])
            );
            return options.ascending ? comparison : -comparison;
          });
          return query;
        },
        limit(value: number) {
          calls.push({ method: 'limit', args: [value] });
          limit = value;
          return query;
        },
        async maybeSingle() {
          calls.push({ method: 'maybeSingle', args: [] });
          if (failure) return { data: null, error: failure };
          const limited = limit === null ? result : result.slice(0, limit);
          return { data: limited[0] ?? null, error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;

  return { db, calls };
}

const ROW_A = attribution(
  'attribution-a',
  'account-a',
  'contact-1',
  '2026-01-01T00:00:00.000Z'
);
const ROW_B = attribution(
  'attribution-b',
  'account-a',
  'contact-1',
  '2026-02-01T00:00:00.000Z'
);

describe('Meta Ads attribution UI reads', () => {
  it('selects the contact attribution with the newest received_at', async () => {
    const { db, calls } = attributionDb([ROW_A, ROW_B]);

    const result = await getLatestContactMetaAttribution(
      db,
      'account-a',
      'contact-1'
    );

    expect(result?.id).toBe('attribution-b');
    expect(calls).toContainEqual({
      method: 'eq',
      args: ['account_id', 'account-a'],
    });
    expect(calls).toContainEqual({
      method: 'eq',
      args: ['contact_id', 'contact-1'],
    });
    expect(calls).toContainEqual({
      method: 'order',
      args: ['received_at', { ascending: false }],
    });
    expect(calls).toContainEqual({ method: 'limit', args: [1] });
  });

  it('returns no section data for an organic contact', async () => {
    const { db } = attributionDb([]);

    await expect(
      getLatestContactMetaAttribution(db, 'account-a', 'organic-contact')
    ).resolves.toBeNull();
  });

  it('uses the deal-fixed attribution instead of the newer contact one', async () => {
    const { db, calls } = attributionDb([ROW_A, ROW_B]);

    const result = await getDealMetaAttribution(db, {
      accountId: 'account-a',
      metaAttributionId: 'attribution-a',
      contactId: 'contact-1',
    });

    expect(result).toEqual({ attribution: ROW_A, source: 'deal_fixed' });
    expect(calls).toContainEqual({
      method: 'eq',
      args: ['id', 'attribution-a'],
    });
    expect(calls.some((call) => call.args[0] === 'contact_id')).toBe(false);
    expect(calls.some((call) => call.method === 'order')).toBe(false);
  });

  it('uses the latest contact attribution only as an unpersisted preview', async () => {
    const { db, calls } = attributionDb([ROW_A, ROW_B]);

    const result = await getDealMetaAttribution(db, {
      accountId: 'account-a',
      metaAttributionId: null,
      contactId: 'contact-1',
    });

    expect(result).toEqual({ attribution: ROW_B, source: 'contact_preview' });
    expect(calls.every((call) => call.method !== 'update')).toBe(true);
    expect(calls.every((call) => call.method !== 'insert')).toBe(true);
  });

  it('does not return a fixed attribution from another account', async () => {
    const { db } = attributionDb([
      attribution(
        'foreign-attribution',
        'account-b',
        'contact-2',
        '2026-03-01T00:00:00.000Z'
      ),
    ]);

    await expect(
      getDealMetaAttribution(db, {
        accountId: 'account-a',
        metaAttributionId: 'foreign-attribution',
        contactId: 'contact-2',
      })
    ).resolves.toEqual({ attribution: null, source: null });
  });

  it('surfaces only a sanitized database error code', async () => {
    const { db } = attributionDb([], {
      code: '42501',
      message: 'private database detail',
    });
    const promise = getLatestContactMetaAttribution(
      db,
      'account-a',
      'contact-1'
    );

    await expect(promise).rejects.toEqual(
      new MetaAttributionViewReadError('42501')
    );
    await expect(promise).rejects.not.toThrow('private database detail');
  });
});
