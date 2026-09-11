import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  admin: {},
  repository: {},
  createMetaEnrichmentRepository: vi.fn(),
  processMetaAdEnrichmentBatch: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => h.admin,
}));
vi.mock('@/lib/meta-conversions/enrichment', () => ({
  createMetaEnrichmentRepository: h.createMetaEnrichmentRepository,
  processMetaAdEnrichmentBatch: h.processMetaAdEnrichmentBatch,
}));

import { GET } from './route';

const originalSecret = process.env.AUTOMATION_CRON_SECRET;

function request(secret?: string) {
  return new Request('http://localhost/api/meta-conversions/enrichment/cron', {
    headers: secret ? { 'x-cron-secret': secret } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTOMATION_CRON_SECRET = 'cron-secret';
  h.createMetaEnrichmentRepository.mockReturnValue(h.repository);
  h.processMetaAdEnrichmentBatch.mockResolvedValue({
    scanned: 2,
    enriched: 1,
    pending: 0,
    failed: 1,
    already_enriched: 0,
    not_found: 0,
    errors: 0,
  });
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.AUTOMATION_CRON_SECRET;
  } else {
    process.env.AUTOMATION_CRON_SECRET = originalSecret;
  }
  vi.restoreAllMocks();
});

describe('Meta attribution enrichment cron', () => {
  it('returns 503 without server-side cron configuration', async () => {
    delete process.env.AUTOMATION_CRON_SECRET;

    const response = await GET(request());

    expect(response).toEqual({
      body: { error: 'cron not configured' },
      init: { status: 503 },
    });
    expect(h.processMetaAdEnrichmentBatch).not.toHaveBeenCalled();
  });

  it('rejects a missing or incorrect secret', async () => {
    await expect(GET(request('wrong-secret'))).resolves.toEqual({
      body: { error: 'Unauthorized' },
      init: { status: 401 },
    });
    expect(h.processMetaAdEnrichmentBatch).not.toHaveBeenCalled();
  });

  it('processes a protected bounded batch and returns its summary', async () => {
    const response = await GET(request('cron-secret'));

    expect(h.createMetaEnrichmentRepository).toHaveBeenCalledWith(h.admin);
    expect(h.processMetaAdEnrichmentBatch).toHaveBeenCalledWith({
      repository: h.repository,
    });
    expect(response).toEqual({
      body: {
        scanned: 2,
        enriched: 1,
        pending: 0,
        failed: 1,
        already_enriched: 0,
        not_found: 0,
        errors: 0,
      },
      init: undefined,
    });
  });

  it('does not expose thrown secrets in logs or response', async () => {
    h.processMetaAdEnrichmentBatch.mockRejectedValueOnce({
      code: '08006',
      message: 'EA_SECRET_TOKEN',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(request('cron-secret'));
    const serialized = JSON.stringify({ response, logs: errorSpy.mock.calls });

    expect(response).toEqual({
      body: { error: 'enrichment batch failed' },
      init: { status: 500 },
    });
    expect(serialized).toContain('08006');
    expect(serialized).not.toContain('EA_SECRET_TOKEN');
    expect(serialized).not.toContain('cron-secret');
  });
});
