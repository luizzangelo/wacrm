import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMetaEnrichmentRepository,
  enrichMetaAdAttribution,
  processMetaAdEnrichmentBatch,
  type MetaEnrichmentCandidate,
  type MetaEnrichmentRepository,
  type StoredMetaAttributionForEnrichment,
  type StoredMetaEnrichmentConfig,
} from './enrichment';
import { MetaMarketingApiError, type MetaAdHierarchy } from './marketing-api';

const HIERARCHY: MetaAdHierarchy = {
  ad_id: 'ad-real',
  ad_name: 'Ad name',
  adset_id: 'adset-1',
  adset_name: 'Ad Set name',
  campaign_id: 'campaign-1',
  campaign_name: 'Campaign name',
};

function attribution(
  overrides: Partial<StoredMetaAttributionForEnrichment> = {}
): StoredMetaAttributionForEnrichment & Record<string, unknown> {
  return {
    id: 'attr-1',
    account_id: 'account-a',
    ad_id: 'ad-webhook',
    source_id: 'source-webhook',
    ad_name: null,
    adset_id: null,
    adset_name: null,
    campaign_id: null,
    campaign_name: null,
    enrichment_status: 'pending',
    received_at: '2026-01-01T00:00:00.000Z',
    ctwa_clid: 'TEST_CtWa-123',
    waba_id: 'waba-original',
    phone_number_id: 'phone-original',
    ...overrides,
  };
}

function config(
  overrides: Partial<StoredMetaEnrichmentConfig> = {}
): StoredMetaEnrichmentConfig {
  return {
    account_id: 'account-a',
    access_token: 'encrypted-primary',
    marketing_access_token: 'encrypted-marketing',
    enabled: true,
    ...overrides,
  };
}

function memoryRepository(options?: {
  rows?: ReturnType<typeof attribution>[];
  configs?: StoredMetaEnrichmentConfig[];
}) {
  const rows = options?.rows ?? [attribution()];
  const configs = options?.configs ?? [config()];
  const repository: MetaEnrichmentRepository = {
    getAttribution: vi.fn(async (accountId, id) => {
      return (
        rows.find((row) => row.id === id && row.account_id === accountId) ??
        null
      );
    }),
    getConfig: vi.fn(async (accountId) => {
      return configs.find((row) => row.account_id === accountId) ?? null;
    }),
    markEnriched: vi.fn(async (accountId, id, hierarchy, enrichedAt) => {
      const row = rows.find(
        (candidate) => candidate.id === id && candidate.account_id === accountId
      );
      if (!row) throw new Error('row missing');
      Object.assign(row, hierarchy, {
        enrichment_status: 'enriched',
        enrichment_error: null,
        enriched_at: enrichedAt,
      });
    }),
    markFailed: vi.fn(async (accountId, id, error) => {
      const row = rows.find(
        (candidate) => candidate.id === id && candidate.account_id === accountId
      );
      if (!row) throw new Error('row missing');
      Object.assign(row, {
        enrichment_status: 'failed',
        enrichment_error: error,
        enriched_at: null,
      });
    }),
    listCandidates: vi.fn(async (limit) =>
      rows
        .filter((row) => ['pending', 'failed'].includes(row.enrichment_status))
        .sort((a, b) => a.received_at.localeCompare(b.received_at))
        .slice(0, limit)
        .map(({ id, account_id }) => ({ id, account_id }))
    ),
  };
  return { repository, rows, configs };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Meta enrichment Supabase repository', () => {
  it('scopes every attribution read/update and the config read by account', async () => {
    const calls: { method: string; args: unknown[]; table: string }[] = [];
    const db = {
      from(table: string) {
        let updated = false;
        const chain = {
          select(...args: unknown[]) {
            calls.push({ method: 'select', args, table });
            return chain;
          },
          update(...args: unknown[]) {
            updated = true;
            calls.push({ method: 'update', args, table });
            return chain;
          },
          eq(...args: unknown[]) {
            calls.push({ method: 'eq', args, table });
            return chain;
          },
          maybeSingle: async () => ({
            data: updated
              ? { id: 'attr-1' }
              : table === 'meta_conversion_config'
                ? config()
                : attribution(),
            error: null,
          }),
        };
        return chain;
      },
    } as unknown as SupabaseClient;
    const repository = createMetaEnrichmentRepository(db);

    await repository.getAttribution('account-a', 'attr-1');
    await repository.getConfig('account-a');
    await repository.markEnriched(
      'account-a',
      'attr-1',
      HIERARCHY,
      '2026-09-11T12:00:00.000Z'
    );
    await repository.markFailed('account-a', 'attr-1', '{"kind":"http"}');

    const attributionCalls = calls.filter(
      (call) => call.table === 'meta_ad_attributions'
    );
    expect(
      attributionCalls.filter(
        (call) => call.method === 'eq' && call.args[0] === 'account_id'
      )
    ).toHaveLength(3);
    expect(
      attributionCalls.filter(
        (call) => call.method === 'eq' && call.args[0] === 'id'
      )
    ).toHaveLength(3);
    expect(calls).toContainEqual({
      method: 'eq',
      args: ['account_id', 'account-a'],
      table: 'meta_conversion_config',
    });

    const updates = attributionCalls
      .filter((call) => call.method === 'update')
      .map((call) => call.args[0] as Record<string, unknown>);
    expect(Object.keys(updates[0]).sort()).toEqual(
      [
        'ad_id',
        'ad_name',
        'adset_id',
        'adset_name',
        'campaign_id',
        'campaign_name',
        'enriched_at',
        'enrichment_error',
        'enrichment_status',
      ].sort()
    );
    expect(Object.keys(updates[1]).sort()).toEqual(
      ['enriched_at', 'enrichment_error', 'enrichment_status'].sort()
    );
    expect(JSON.stringify(updates)).not.toContain('ctwa_clid');
    expect(JSON.stringify(updates)).not.toContain('waba_id');
  });
});

describe('Meta attribution enrichment', () => {
  it('enriches a pending attribution and changes only enrichment fields', async () => {
    const { repository, rows } = memoryRepository();
    const before = structuredClone(rows[0]);
    const decryptToken = vi.fn(() => 'marketing-token');
    const readHierarchy = vi.fn(async () => HIERARCHY);

    const result = await enrichMetaAdAttribution({
      repository,
      accountId: 'account-a',
      attributionId: 'attr-1',
      decryptToken,
      readHierarchy,
      now: () => new Date('2026-09-11T12:00:00.000Z'),
    });

    expect(result).toEqual({ status: 'enriched' });
    expect(decryptToken).toHaveBeenCalledWith('encrypted-marketing');
    expect(readHierarchy).toHaveBeenCalledWith('ad-webhook', 'marketing-token');
    expect(rows[0]).toMatchObject({
      ...HIERARCHY,
      enrichment_status: 'enriched',
      enriched_at: '2026-09-11T12:00:00.000Z',
      enrichment_error: null,
      ctwa_clid: 'TEST_CtWa-123',
      waba_id: 'waba-original',
      phone_number_id: 'phone-original',
      account_id: before.account_id,
      source_id: before.source_id,
      received_at: before.received_at,
    });
  });

  it('falls back to the primary token and source_id', async () => {
    const { repository } = memoryRepository({
      rows: [attribution({ ad_id: null })],
      configs: [config({ marketing_access_token: null })],
    });
    const decryptToken = vi.fn(() => 'primary-token');
    const readHierarchy = vi.fn(async () => HIERARCHY);

    await enrichMetaAdAttribution({
      repository,
      accountId: 'account-a',
      attributionId: 'attr-1',
      decryptToken,
      readHierarchy,
    });

    expect(decryptToken).toHaveBeenCalledWith('encrypted-primary');
    expect(readHierarchy).toHaveBeenCalledWith(
      'source-webhook',
      'primary-token'
    );
  });

  it.each([
    ['missing config', []],
    [
      'missing tokens',
      [config({ access_token: null, marketing_access_token: null })],
    ],
  ])('keeps pending and does not call Meta for %s', async (_label, configs) => {
    const { repository, rows } = memoryRepository({ configs });
    const readHierarchy = vi.fn(async () => HIERARCHY);

    const result = await enrichMetaAdAttribution({
      repository,
      accountId: 'account-a',
      attributionId: 'attr-1',
      readHierarchy,
    });

    expect(result).toEqual({
      status: 'pending',
      reason: 'missing_credentials',
    });
    expect(rows[0].enrichment_status).toBe('pending');
    expect(readHierarchy).not.toHaveBeenCalled();
  });

  it('keeps pending when ciphertext cannot be decrypted', async () => {
    const { repository, rows } = memoryRepository();
    const readHierarchy = vi.fn(async () => HIERARCHY);

    const result = await enrichMetaAdAttribution({
      repository,
      accountId: 'account-a',
      attributionId: 'attr-1',
      decryptToken: () => {
        throw new Error('ciphertext and token must stay private');
      },
      readHierarchy,
    });

    expect(result).toEqual({
      status: 'pending',
      reason: 'unreadable_credentials',
    });
    expect(rows[0].enrichment_status).toBe('pending');
    expect(readHierarchy).not.toHaveBeenCalled();
  });

  it('enriches with a token even when conversion sending is disabled', async () => {
    const { repository } = memoryRepository({
      configs: [config({ enabled: false })],
    });
    const readHierarchy = vi.fn(async () => HIERARCHY);

    await expect(
      enrichMetaAdAttribution({
        repository,
        accountId: 'account-a',
        attributionId: 'attr-1',
        decryptToken: () => 'token',
        readHierarchy,
      })
    ).resolves.toEqual({ status: 'enriched' });
    expect(readHierarchy).toHaveBeenCalledOnce();
  });

  it('is a no-op when an enriched row already has the full hierarchy', async () => {
    const { repository } = memoryRepository({
      rows: [
        attribution({
          ...HIERARCHY,
          enrichment_status: 'enriched',
        }),
      ],
    });
    const readHierarchy = vi.fn(async () => HIERARCHY);

    await expect(
      enrichMetaAdAttribution({
        repository,
        accountId: 'account-a',
        attributionId: 'attr-1',
        readHierarchy,
      })
    ).resolves.toEqual({ status: 'already_enriched' });
    expect(repository.getConfig).not.toHaveBeenCalled();
    expect(readHierarchy).not.toHaveBeenCalled();
  });

  it('retries a failed attribution and succeeds on the next invocation', async () => {
    const { repository, rows } = memoryRepository();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const readHierarchy = vi
      .fn()
      .mockRejectedValueOnce(
        new MetaMarketingApiError({
          kind: 'http',
          http_status: 500,
          code: 1,
          message: 'Temporary error',
        })
      )
      .mockResolvedValueOnce(HIERARCHY);
    const common = {
      repository,
      accountId: 'account-a',
      attributionId: 'attr-1',
      decryptToken: () => 'token',
      readHierarchy,
    };

    await expect(enrichMetaAdAttribution(common)).resolves.toMatchObject({
      status: 'failed',
    });
    expect(rows[0].enrichment_status).toBe('failed');
    await expect(enrichMetaAdAttribution(common)).resolves.toEqual({
      status: 'enriched',
    });
    expect(rows[0].enrichment_status).toBe('enriched');
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('does not cross account boundaries or read that account token', async () => {
    const { repository } = memoryRepository();
    const readHierarchy = vi.fn(async () => HIERARCHY);

    await expect(
      enrichMetaAdAttribution({
        repository,
        accountId: 'account-b',
        attributionId: 'attr-1',
        readHierarchy,
      })
    ).resolves.toEqual({ status: 'not_found' });
    expect(repository.getConfig).not.toHaveBeenCalled();
    expect(readHierarchy).not.toHaveBeenCalled();
  });

  it('stores, logs, and returns only sanitized Meta error details', async () => {
    const secret = 'EA_SECRET_TOKEN';
    const { repository, rows } = memoryRepository();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const safeError = new MetaMarketingApiError({
      kind: 'http',
      http_status: 403,
      code: 200,
      subcode: 18157520,
      type: 'OAuthException',
      message: 'Permissions error',
      fbtrace_id: 'trace-1',
    });

    const result = await enrichMetaAdAttribution({
      repository,
      accountId: 'account-a',
      attributionId: 'attr-1',
      decryptToken: () => secret,
      readHierarchy: async () => {
        throw safeError;
      },
    });

    const serialized = JSON.stringify({
      result,
      row: rows[0],
      logs: errorSpy.mock.calls,
    });
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain('Permissions error');
    expect(serialized).toContain('18157520');
  });

  it('marks a missing ad_id/source_id as a sanitized permanent failure', async () => {
    const { repository, rows } = memoryRepository({
      rows: [attribution({ ad_id: null, source_id: null })],
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await enrichMetaAdAttribution({
      repository,
      accountId: 'account-a',
      attributionId: 'attr-1',
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: { kind: 'invalid_attribution' },
    });
    expect(rows[0].enrichment_status).toBe('failed');
    expect(repository.getConfig).not.toHaveBeenCalled();
  });
});

describe('Meta attribution recovery batch', () => {
  it('honors the limit/order, skips enriched, and isolates item errors', async () => {
    const rows = [
      attribution({ id: 'new-pending', received_at: '2026-01-03T00:00:00Z' }),
      attribution({
        id: 'old-failed',
        enrichment_status: 'failed',
        received_at: '2026-01-01T00:00:00Z',
      }),
      attribution({
        id: 'middle-pending',
        received_at: '2026-01-02T00:00:00Z',
      }),
      attribution({
        id: 'already',
        enrichment_status: 'enriched',
        received_at: '2025-01-01T00:00:00Z',
      }),
    ];
    const { repository } = memoryRepository({ rows });
    const seen: string[] = [];
    const enrichOne = vi.fn(async (candidate: MetaEnrichmentCandidate) => {
      seen.push(candidate.id);
      if (candidate.id === 'old-failed') throw new Error('isolated failure');
      return { status: 'enriched' as const };
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await processMetaAdEnrichmentBatch({
      repository,
      batchSize: 2,
      enrichOne,
    });

    expect(seen).toEqual(['old-failed', 'middle-pending']);
    expect(seen).not.toContain('already');
    expect(result).toEqual({
      scanned: 2,
      enriched: 1,
      pending: 0,
      failed: 0,
      already_enriched: 0,
      not_found: 0,
      errors: 1,
    });
  });
});
