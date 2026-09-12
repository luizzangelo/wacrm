import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  admin: {},
  repository: {},
  createMetaConversionEventRepository: vi.fn(),
  processMetaConversionEventBatch: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}));
vi.mock('@/lib/meta-conversions/admin-client', () => ({
  metaConversionsAdmin: () => h.admin,
}));
vi.mock('@/lib/meta-conversions/conversion-sender', () => ({
  createMetaConversionEventRepository: h.createMetaConversionEventRepository,
  processMetaConversionEventBatch: h.processMetaConversionEventBatch,
}));

import { GET } from './route';

const originalSecret = process.env.AUTOMATION_CRON_SECRET;

function request(secret?: string) {
  return new Request('http://localhost/api/meta-conversions/events/cron', {
    headers: secret ? { 'x-cron-secret': secret } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTOMATION_CRON_SECRET = 'cron-secret';
  h.createMetaConversionEventRepository.mockReturnValue(h.repository);
  h.processMetaConversionEventBatch.mockResolvedValue({
    recovered_sending: 1,
    scanned: 3,
    sent: 1,
    failed: 1,
    delivery_unknown: 2,
    skipped_disabled: 0,
    skipped_missing_config: 0,
    skipped_no_attribution: 0,
    busy: 0,
    ignored: 0,
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

describe('Meta conversion delivery cron', () => {
  it('returns 503 when the server-side cron secret is absent', async () => {
    delete process.env.AUTOMATION_CRON_SECRET;

    await expect(GET(request())).resolves.toEqual({
      body: { error: 'cron not configured' },
      init: { status: 503 },
    });
    expect(h.processMetaConversionEventBatch).not.toHaveBeenCalled();
  });

  it('rejects a missing or incorrect secret', async () => {
    await expect(GET(request('incorrect'))).resolves.toEqual({
      body: { error: 'Unauthorized' },
      init: { status: 401 },
    });
    expect(h.processMetaConversionEventBatch).not.toHaveBeenCalled();
  });

  it('runs the protected delivery batch', async () => {
    const response = await GET(request('cron-secret'));

    expect(h.createMetaConversionEventRepository).toHaveBeenCalledWith(h.admin);
    expect(h.processMetaConversionEventBatch).toHaveBeenCalledWith({
      repository: h.repository,
    });
    expect(response.body).toMatchObject({
      recovered_sending: 1,
      scanned: 3,
      sent: 1,
      failed: 1,
      delivery_unknown: 2,
    });
  });

  it('does not expose thrown secrets in logs or response', async () => {
    h.processMetaConversionEventBatch.mockRejectedValueOnce({
      code: '08006',
      message: 'EA_SECRET_TOKEN',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(request('cron-secret'));
    const serialized = JSON.stringify({ response, logs: errorSpy.mock.calls });

    expect(response).toEqual({
      body: { error: 'conversion delivery batch failed' },
      init: { status: 500 },
    });
    expect(serialized).toContain('08006');
    expect(serialized).not.toContain('EA_SECRET_TOKEN');
    expect(serialized).not.toContain('cron-secret');
  });
});
