import { describe, expect, it, vi } from 'vitest';

import type { MetaConversionsRequest } from './conversions-api';
import { sendMetaConversionEvent } from './conversions-api';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const TOKEN = 'EA_CONVERSION_SECRET';
const CTWA = 'ARawClickIdentifier_KeepExactly';
const payload: MetaConversionsRequest = {
  data: [
    {
      event_name: 'LeadSubmitted',
      event_time: 1_725_000_000,
      event_id: 'meta:account:deal:LeadSubmitted',
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: {
        whatsapp_business_account_id: 'waba-123',
        ctwa_clid: CTWA,
      },
    },
  ],
};

describe('Meta Conversions API client', () => {
  it('posts one exact Business Messaging event with Bearer auth', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        events_received: 1,
        messages: [],
        fbtrace_id: 'trace-1',
      })
    );

    const result = await sendMetaConversionEvent({
      datasetId: 'dataset/unsafe-segment',
      accessToken: TOKEN,
      payload,
      fetcher,
    });

    expect(result).toEqual({
      classification: 'SUCCESS',
      httpStatus: 200,
      response: { events_received: 1, fbtrace_id: 'trace-1' },
      errorMessage: null,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(
      'https://graph.facebook.com/v26.0/dataset%2Funsafe-segment/events'
    );
    expect(String(url)).not.toContain(TOKEN);
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual(payload);
    expect(String(init?.body)).not.toContain('email');
    expect(String(init?.body)).not.toContain('phone');
  });

  it('does not trust HTTP 2xx without a positive receipt count', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ events_received: 0, messages: [] }));

    const result = await sendMetaConversionEvent({
      datasetId: 'dataset-1',
      accessToken: TOKEN,
      payload,
      fetcher,
    });

    expect(result).toMatchObject({
      classification: 'DELIVERY_UNKNOWN',
      httpStatus: 200,
      response: { events_received: 0 },
      errorMessage: 'Meta Conversions API did not confirm event receipt',
      errorCode: 'delivery_unknown_ambiguous_response',
    });
  });

  it.each([
    [400, 'DEFINITE_REJECTION', 'meta_http_rejection'],
    [401, 'DEFINITE_REJECTION', 'meta_http_rejection'],
    [403, 'DEFINITE_REJECTION', 'meta_http_rejection'],
    [404, 'DEFINITE_REJECTION', 'meta_http_rejection'],
    [422, 'DEFINITE_REJECTION', 'meta_http_rejection'],
    [429, 'DELIVERY_UNKNOWN', 'delivery_unknown_rate_limit'],
    [500, 'DELIVERY_UNKNOWN', 'delivery_unknown_server_error'],
    [503, 'DELIVERY_UNKNOWN', 'delivery_unknown_server_error'],
  ] as const)(
    'classifies HTTP %i as %s',
    async (status, classification, errorCode) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: status === 429 ? 613 : 100,
              error_subcode: 33,
              type: 'OAuthException',
              message: `Bearer ${TOKEN} rejected ${CTWA}`,
              fbtrace_id: 'trace-error',
              ignored_secret: TOKEN,
            },
            ignored_payload: { ctwa_clid: CTWA },
          },
          status
        )
      );

      const result = await sendMetaConversionEvent({
        datasetId: 'dataset-1',
        accessToken: TOKEN,
        payload,
        fetcher,
      });
      const serialized = JSON.stringify(result);

      expect(result).toMatchObject({
        classification,
        errorCode,
        httpStatus: status,
        response: {
          fbtrace_id: 'trace-error',
          error: {
            code: status === 429 ? 613 : 100,
            error_subcode: 33,
            type: 'OAuthException',
          },
        },
        metaCode: status === 429 ? 613 : 100,
        metaSubcode: 33,
      });
      expect(serialized).not.toContain(TOKEN);
      expect(serialized).not.toContain(CTWA);
      expect(serialized).not.toContain('ignored_payload');
      expect(serialized).toContain('[redacted]');
    }
  );

  it('treats a Graph rate-limit code on HTTP 400 as delivery unknown', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: 4, message: 'Application request limit' } },
          400
        )
      );

    await expect(
      sendMetaConversionEvent({
        datasetId: 'dataset-1',
        accessToken: TOKEN,
        payload,
        fetcher,
      })
    ).resolves.toMatchObject({
      classification: 'DELIVERY_UNKNOWN',
      httpStatus: 400,
      errorCode: 'delivery_unknown_rate_limit',
      metaCode: 4,
    });
  });

  it.each(['AbortError', 'TimeoutError'])(
    'classifies %s as a sanitized ambiguous timeout',
    async (name) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockRejectedValue(Object.assign(new Error(TOKEN), { name }));

      await expect(
        sendMetaConversionEvent({
          datasetId: 'dataset-1',
          accessToken: TOKEN,
          payload,
          fetcher,
        })
      ).resolves.toEqual({
        classification: 'DELIVERY_UNKNOWN',
        httpStatus: null,
        response: null,
        errorMessage: 'Meta Conversions API request timed out',
        errorCode: 'delivery_unknown_timeout',
      });
    }
  );

  it('classifies a network failure without exposing the thrown error', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`socket contained ${TOKEN} and ${CTWA}`));

    const result = await sendMetaConversionEvent({
      datasetId: 'dataset-1',
      accessToken: TOKEN,
      payload,
      fetcher,
    });

    expect(result).toEqual({
      classification: 'DELIVERY_UNKNOWN',
      httpStatus: null,
      response: null,
      errorMessage: 'Meta Conversions API network request failed',
      errorCode: 'delivery_unknown_network',
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(CTWA);
  });

  it('treats invalid JSON success responses as delivery unknown', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>proxy</html>', { status: 200 }));

    await expect(
      sendMetaConversionEvent({
        datasetId: 'dataset-1',
        accessToken: TOKEN,
        payload,
        fetcher,
      })
    ).resolves.toMatchObject({
      classification: 'DELIVERY_UNKNOWN',
      httpStatus: 200,
      response: null,
      errorCode: 'delivery_unknown_ambiguous_response',
    });
  });
});
