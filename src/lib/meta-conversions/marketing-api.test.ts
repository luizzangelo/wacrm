import { describe, expect, it, vi } from 'vitest';

import { MetaMarketingApiError, readMetaAdHierarchy } from './marketing-api';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const TOKEN = 'EA_MARKETING_SECRET';

describe('Meta Marketing API ad hierarchy', () => {
  it('reads Ad, Ad Set, and Campaign through nested fields in one request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'ad-1',
        name: 'Ad Name',
        adset: { id: 'adset-1', name: 'Ad Set Name' },
        campaign: { id: 'campaign-1', name: 'Campaign Name' },
      })
    );

    const result = await readMetaAdHierarchy('ad-1', TOKEN, fetcher);

    expect(result).toEqual({
      ad_id: 'ad-1',
      ad_name: 'Ad Name',
      adset_id: 'adset-1',
      adset_name: 'Ad Set Name',
      campaign_id: 'campaign-1',
      campaign_name: 'Campaign Name',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain('/v26.0/ad-1?fields=');
    expect(decodeURIComponent(String(url))).toContain(
      'fields=id,name,adset{id,name},campaign{id,name},adset_id,campaign_id'
    );
    expect(String(url)).not.toContain(TOKEN);
    expect(init).toMatchObject({
      method: 'GET',
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache: 'no-store',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('falls back only for nested names omitted by the Ad response', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'ad-1',
          name: 'Ad Name',
          adset_id: 'adset-1',
          campaign_id: 'campaign-1',
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'adset-1', name: 'Set' }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 'campaign-1', name: 'Campaign' })
      );

    const result = await readMetaAdHierarchy('ad-1', TOKEN, fetcher);

    expect(result).toMatchObject({
      adset_id: 'adset-1',
      adset_name: 'Set',
      campaign_id: 'campaign-1',
      campaign_name: 'Campaign',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const fallbackUrls = fetcher.mock.calls
      .slice(1)
      .map(([url]) => decodeURIComponent(String(url)));
    expect(fallbackUrls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/adset-1?fields=id,name'),
        expect.stringContaining('/campaign-1?fields=id,name'),
      ])
    );
  });

  it.each([
    [401, 190, 'OAuthException'],
    [403, 200, 'OAuthException'],
    [404, 100, 'GraphMethodException'],
    [429, 613, 'OAuthException'],
    [500, 1, 'OAuthException'],
  ])('sanitizes HTTP %i errors', async (httpStatus, code, type) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code,
            error_subcode: 123,
            type,
            message: `Request failed for Bearer ${TOKEN}`,
            fbtrace_id: 'trace-123',
            ignored_secret: TOKEN,
          },
        },
        httpStatus
      )
    );

    const promise = readMetaAdHierarchy('ad-1', TOKEN, fetcher);

    await expect(promise).rejects.toMatchObject({
      details: {
        kind: 'http',
        http_status: httpStatus,
        code,
        subcode: 123,
        type,
        message: 'Request failed for Bearer [redacted]',
        fbtrace_id: 'trace-123',
      },
    } satisfies Partial<MetaMarketingApiError>);
    await expect(promise).rejects.not.toThrow(TOKEN);
  });

  it('classifies explicit timeouts without exposing the thrown error', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        Object.assign(new Error(`timeout ${TOKEN}`), { name: 'TimeoutError' })
      );

    await expect(
      readMetaAdHierarchy('ad-1', TOKEN, fetcher)
    ).rejects.toMatchObject({
      details: {
        kind: 'timeout',
        message: 'Meta Marketing API request timed out',
      },
    });
  });

  it('classifies network errors without exposing the thrown error', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`socket URL contained ${TOKEN}`));

    await expect(
      readMetaAdHierarchy('ad-1', TOKEN, fetcher)
    ).rejects.toMatchObject({
      details: {
        kind: 'network',
        message: 'Meta Marketing API network request failed',
      },
    });
  });

  it('rejects a successful but incomplete hierarchy', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ id: 'ad-1', name: 'Ad Name' }));

    await expect(
      readMetaAdHierarchy('ad-1', TOKEN, fetcher)
    ).rejects.toMatchObject({
      details: { kind: 'incomplete_response' },
    });
  });
});
