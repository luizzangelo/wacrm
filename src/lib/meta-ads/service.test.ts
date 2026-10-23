import { describe, expect, it } from 'vitest';

import { safeMetaAdsStatus } from './service';

describe('Meta Ads safe status', () => {
  it('returns only non-sensitive account metadata', () => {
    const status = safeMetaAdsStatus({
      marketing_access_token: 'encrypted-secret',
      marketing_token_source: 'facebook_login',
      marketing_ad_account_id: '12345',
      marketing_ad_account_name: 'Main account',
      marketing_connected_at: '2026-10-23T12:00:00.000Z',
      marketing_ad_accounts: [
        { id: '12345', name: 'Main account', accountStatus: 1 },
      ],
    });
    expect(status).toEqual({
      connected: true,
      source: 'facebook_login',
      adAccount: { id: 'act_12345', name: 'Main account' },
      connectedAt: '2026-10-23T12:00:00.000Z',
    });
    expect(JSON.stringify(status)).not.toContain('encrypted-secret');
  });

  it('does not present a legacy manual token as a Facebook Login connection', () => {
    expect(
      safeMetaAdsStatus({
        marketing_access_token: 'encrypted-secret',
        marketing_token_source: 'manual',
        marketing_ad_account_id: null,
        marketing_ad_account_name: null,
        marketing_connected_at: null,
        marketing_ad_accounts: null,
      }).connected
    ).toBe(false);
  });
});
