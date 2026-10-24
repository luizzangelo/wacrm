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
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
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
    expect(log).toHaveBeenCalledWith('[meta-ads/debug-token]', {
      type: null,
      scopes: [],
      granular_scopes: [{ scope: 'ads_read', target_ids: ['11111', '22222'] }],
    });
    expect(log).toHaveBeenCalledWith('[meta-ads/account-discovery]', {
      route: 'granular_scopes',
      candidates: 2,
      accessible: 2,
    });
    log.mockRestore();
  });

  it('falls back to /me/adaccounts when ads_read is in scopes', async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/debug_token')) {
        return json({
          data: { is_valid: true, type: 'USER', scopes: ['ads_read'] },
        });
      }
      if (url.pathname.endsWith('/me/adaccounts')) {
        return json({
          data: [{ id: 'act_33333', account_id: '33333', name: 'Listed' }],
        });
      }
      return json({
        account_id: '33333',
        name: 'Account 33333',
        account_status: 1,
      });
    });
    await expect(
      discoverMetaAdAccounts(config, 'USER_TOKEN', fetcher as typeof fetch)
    ).resolves.toEqual([
      { id: '33333', name: 'Account 33333', accountStatus: 1 },
    ]);
    expect(
      fetcher.mock.calls.some(([input]) =>
        new URL(String(input)).pathname.endsWith('/me/adaccounts')
      )
    ).toBe(true);
  });

  it('falls back through business ad-account edges and proves practical access', async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/debug_token')) {
        return json({
          data: {
            is_valid: true,
            granular_scopes: [
              { scope: 'business_management', target_ids: ['44444'] },
            ],
          },
        });
      }
      if (url.pathname.endsWith('/44444/owned_ad_accounts')) {
        return json({ data: [{ id: 'act_55555' }] });
      }
      if (url.pathname.endsWith('/44444/client_ad_accounts')) {
        return json({ data: [] });
      }
      if (url.pathname.endsWith('/act_55555')) {
        return json({
          account_id: '55555',
          name: 'Business account',
          account_status: 1,
        });
      }
      throw new Error(`Unexpected URL: ${url.pathname}`);
    });
    await expect(
      discoverMetaAdAccounts(config, 'USER_TOKEN', fetcher as typeof fetch)
    ).resolves.toEqual([
      { id: '55555', name: 'Business account', accountStatus: 1 },
    ]);
  });

  it('distinguishes a missing ads_read grant from no accessible accounts', async () => {
    const noPermissionFetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/debug_token')) {
        return json({ data: { is_valid: true, scopes: [] } });
      }
      if (url.pathname.endsWith('/me/businesses')) return json({ data: [] });
      throw new Error(`Unexpected URL: ${url.pathname}`);
    });
    await expect(
      discoverMetaAdAccounts(
        config,
        'USER_TOKEN',
        noPermissionFetcher as typeof fetch
      )
    ).rejects.toMatchObject({
      publicCode: 'ads_read_missing',
      status: 400,
    });

    const noAccountsFetcher = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      return url.pathname.endsWith('/debug_token')
        ? json({ data: { is_valid: true, scopes: ['ads_read'] } })
        : json({ data: [] });
    });
    await expect(
      discoverMetaAdAccounts(
        config,
        'USER_TOKEN',
        noAccountsFetcher as typeof fetch
      )
    ).rejects.toMatchObject({
      publicCode: 'no_ad_accounts',
      status: 400,
    });
  });
});
