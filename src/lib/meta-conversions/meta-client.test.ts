import { describe, expect, it, vi } from 'vitest';

import { validateMetaCredentials } from './meta-client';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseInput = {
  datasetId: '123456789',
  accessToken: 'EA_PRIMARY_TOKEN',
  wabaId: 'waba-1',
};

describe('Meta read-only validation', () => {
  it('validates an accessible AdsPixel with a GET request', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ id: '123456789', name: 'Business messaging dataset' })
      );

    const result = await validateMetaCredentials(baseInput, fetcher);

    expect(result.valid).toBe(true);
    expect(result.read_only).toBe(true);
    expect(result.token.status).toBe('valid');
    expect(result.dataset).toMatchObject({
      status: 'valid',
      object_id: '123456789',
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain('/v26.0/123456789?fields=id%2Cname');
    expect(init?.method).toBe('GET');
    expect(String(url)).not.toContain('/events');
  });

  it('classifies an invalid token without exposing Meta response details', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { code: 190, message: 'secret detail' } }, 401)
      );

    const result = await validateMetaCredentials(baseInput, fetcher);

    expect(result.valid).toBe(false);
    expect(result.token.status).toBe('invalid_token');
    expect(JSON.stringify(result)).not.toContain('secret detail');
  });

  it('classifies HTTP 403 as insufficient permission', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: { code: 200 } }, 403));

    const result = await validateMetaCredentials(baseInput, fetcher);

    expect(result.token.status).toBe('valid');
    expect(result.dataset.status).toBe('forbidden');
  });

  it('classifies a missing AdsPixel object', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: { code: 100 } }, 400));

    const result = await validateMetaCredentials(baseInput, fetcher);

    expect(result.token.status).toBe('valid');
    expect(result.dataset.status).toBe('not_found');
  });

  it('handles a timeout or network error without throwing raw details', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('socket included a sensitive URL'));

    const result = await validateMetaCredentials(baseInput, fetcher);

    expect(result.valid).toBe(false);
    expect(result.token.status).toBe('network_error');
    expect(JSON.stringify(result)).not.toContain('sensitive URL');
  });

  it('validates an optional Marketing token with GET /me only', async () => {
    const fetcher = vi
      .fn<
        (input: string | URL | Request, init?: RequestInit) => Promise<Response>
      >()
      .mockResolvedValueOnce(
        jsonResponse({ id: '123456789', name: 'Business messaging dataset' })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'system-user-1' }));

    const result = await validateMetaCredentials(
      { ...baseInput, marketingAccessToken: 'EA_MARKETING_TOKEN' },
      fetcher
    );

    expect(result.valid).toBe(true);
    expect(result.marketing_token).toMatchObject({
      configured: true,
      status: 'valid',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls) {
      expect(init?.method).toBe('GET');
      expect(String(url)).not.toContain('/events');
    }
    expect(String(fetcher.mock.calls[1][0])).toContain('/v26.0/me?fields=id');
  });
});
