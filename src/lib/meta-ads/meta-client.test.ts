import { describe, expect, it, vi } from 'vitest';

import type { MetaAdsServerConfig } from './config';
import { discoverMetaAdAccounts, exchangeMetaAdsCode } from './meta-client';

const config: MetaAdsServerConfig = {
  appId: '1234567890',
  appSecret: 'app-secret',
  loginConfigId: '9876543210',
  graphVersion: 'v21.0',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Meta Ads Facebook Login client', () => {
  it('exchanges the JS SDK code without inventing a redirect_uri', async () => {
    const fetcher = vi.fn(async () => json({ access_token: 'USER_TOKEN' }));
    await expect(
      exchangeMetaAdsCode(config, 'ONE_TIME_CODE', fetcher as typeof fetch)
    ).resolves.toBe('USER_TOKEN');

    const [calledUrl] = fetcher.mock.calls[0] as unknown as [URL];
    const url = new URL(String(calledUrl));
    expect(url.pathname).toBe('/v21.0/oauth/access_token');
    expect(url.searchParams.get('client_id')).toBe(config.appId);
    expect(url.searchParams.get('client_secret')).toBe(config.appSecret);
    expect(url.searchParams.get('code')).toBe('ONE_TIME_CODE');
    expect(url.searchParams.has('redirect_uri')).toBe(false);
  });

  it('uses only ads_read target_ids and reads each account without exposing the token in its URL', async () => {
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/debug_token')) {
        return json({
          data: {
            is_valid: true,
            granular_scopes: [
              { scope: 'ads_read', target_ids: ['11111', '22222'] },
            ],
          },
        });
      }
      const id = url.pathname.endsWith('act_11111') ? '11111' : '22222';
      expect(url.searchParams.has('access_token')).toBe(false);
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        'Bearer USER_TOKEN'
      );
      return json({ account_id: id, name: `Account ${id}`, account_status: 1 });
    });

    await expect(
      discoverMetaAdAccounts(config, 'USER_TOKEN', fetcher as typeof fetch)
    ).resolves.toEqual([
      { id: '11111', name: 'Account 11111', accountStatus: 1 },
      { id: '22222', name: 'Account 22222', accountStatus: 1 },
    ]);
  });

  it('rejects a token whose granular scopes do not contain ads_read', async () => {
    const fetcher = vi.fn(async () =>
      json({ data: { is_valid: true, granular_scopes: [] } })
    );
    await expect(
      discoverMetaAdAccounts(config, 'USER_TOKEN', fetcher as typeof fetch)
    ).rejects.toMatchObject({
      publicCode: 'ads_read_missing',
      status: 400,
    });
  });
});
