import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddedSignupServerConfig } from './embedded-signup-config';
import {
  discoverWabaPhoneNumbers,
  EmbeddedSignupMetaError,
  exchangeAuthorizationCode,
  requestCoexistenceSync,
  subscribeAndConfirmWaba,
  validateAccessToken,
} from './embedded-signup-meta';

const config: EmbeddedSignupServerConfig = {
  appId: '1661839952034827',
  configId: '1449663160367056',
  graphVersion: 'v26.0',
  appSecret: 'test-secret',
};

afterEach(() => vi.unstubAllGlobals());

describe('Embedded Signup Meta client', () => {
  it('exchanges the one-time code once and never exposes it in returned data', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'business-token',
            token_type: 'bearer',
            expires_in: 60,
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    const result = await exchangeAuthorizationCode(config, 'single-use-code');
    expect(result.accessToken).toBe('business-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET' });
  });

  it('classifies an ambiguous exchange and does not retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      exchangeAuthorizationCode(config, 'single-use-code')
    ).rejects.toMatchObject({
      reason: 'exchange_outcome_unknown',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requires the expected app and both WhatsApp permissions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              app_id: config.appId,
              is_valid: true,
              scopes: ['whatsapp_business_management'],
            },
          }),
          { status: 200 }
        )
      )
    );
    await expect(validateAccessToken(config, 'token')).rejects.toMatchObject({
      reason: 'missing_permissions',
    });
  });

  it('maps only documented phone fields and keeps bearer auth out of URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: '108261528923943',
              display_phone_number: '+55 85 99999-0000',
              verified_name: 'Example',
              is_on_biz_app: true,
              platform_type: 'CLOUD_API',
            },
          ],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      discoverWabaPhoneNumbers(config, 'private-token', '2295585011204142')
    ).resolves.toEqual([
      {
        id: '108261528923943',
        displayPhoneNumber: '+55 85 99999-0000',
        verifiedName: 'Example',
        isOnBizApp: true,
        platformType: 'CLOUD_API',
      },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('private-token');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer private-token' },
    });
  });

  it('subscribes exactly once and confirms this app before succeeding', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ whatsapp_business_api_data: { id: config.appId } }],
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      subscribeAndConfirmWaba(config, 'token', '2295585011204142')
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });

  it('requests each documented coexistence sync without retrying', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ request_id: 'request-1' }), {
          status: 200,
        })
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      requestCoexistenceSync(config, 'token', '108261528923943', 'history')
    ).resolves.toBe('request-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      messaging_product: 'whatsapp',
      sync_type: 'history',
    });
  });

  it('uses closed-vocabulary errors without Graph response text', () => {
    const error = new EmbeddedSignupMetaError('invalid_token', 400, 190, 463);
    expect(error.message).toBe('invalid_token');
    expect(error).not.toHaveProperty('accessToken');
  });
});
