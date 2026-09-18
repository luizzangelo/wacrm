import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildMetaConversionPayload,
  createMetaConversionEventRepository,
  processMetaConversionEvent,
  processMetaConversionEventBatch,
  type MetaConversionCandidate,
  type MetaConversionEventRepository,
  type StoredMetaConversionAttribution,
  type StoredMetaConversionContact,
  type StoredMetaConversionDeliveryConfig,
  type StoredMetaConversionEvent,
} from './conversion-sender';
import { sendMetaConversionEvent, type MetaConversionDeliveryResult } from './conversions-api';
import { sha256ForMeta } from './meta-capi-user-data';

const ACCOUNT = 'account-1';
const EVENT_DB_ID = 'event-row-1';
const TOKEN_CIPHERTEXT = 'encrypted-conversion-token';
const HASH = /^[a-f0-9]{64}$/;

function event(
  overrides: Partial<StoredMetaConversionEvent> = {}
): StoredMetaConversionEvent {
  return {
    id: EVENT_DB_ID,
    account_id: ACCOUNT,
    attribution_id: 'attribution-1',
    event_name: 'LeadSubmitted',
    event_id: 'meta:account-1:deal-1:LeadSubmitted',
    event_time: '2026-09-11T12:34:56.789Z',
    value: null,
    currency: null,
    status: 'pending',
    attempts: 0,
    created_at: '2026-09-11T12:35:00.000Z',
    updated_at: '2026-09-11T12:35:00.000Z',
    ...overrides,
  };
}

function config(
  overrides: Partial<StoredMetaConversionDeliveryConfig> = {}
): StoredMetaConversionDeliveryConfig {
  return {
    account_id: ACCOUNT,
    dataset_id: 'dataset-1',
    access_token: TOKEN_CIPHERTEXT,
    enabled: true,
    ...overrides,
  };
}

function attribution(
  overrides: Partial<StoredMetaConversionAttribution> = {}
): StoredMetaConversionAttribution {
  return {
    id: 'attribution-1',
    account_id: ACCOUNT,
    contact_id: 'contact-1',
    ctwa_clid: 'CtWa_RAW_keep-byte-for-byte',
    waba_id: 'waba-snapshot-1',
    ...overrides,
  };
}

function contact(
  overrides: Partial<StoredMetaConversionContact> = {}
): StoredMetaConversionContact {
  return {
    id: 'contact-1',
    account_id: ACCOUNT,
    phone: '+1 (415) 555-1212',
    email: ' Test.User@Example.COM ',
    name: 'Maria da Silva',
    ...overrides,
  };
}

const success: MetaConversionDeliveryResult = {
  classification: 'SUCCESS',
  httpStatus: 200,
  response: { events_received: 1, fbtrace_id: 'trace-1' },
  errorMessage: null,
};

class MemoryRepository implements MetaConversionEventRepository {
  storedEvent: StoredMetaConversionEvent;
  storedConfig: StoredMetaConversionDeliveryConfig | null = config();
  storedAttribution: StoredMetaConversionAttribution | null = attribution();
  storedContact: StoredMetaConversionContact | null = contact();
  pendingCandidates: MetaConversionCandidate[] = [
    { id: EVENT_DB_ID, account_id: ACCOUNT },
  ];
  attemptResults: Array<Record<string, unknown>> = [];
  preflightWrites: Array<Record<string, unknown>> = [];
  recoveryWrites: Array<Record<string, unknown>> = [];
  claims = 0;

  constructor(storedEvent = event()) {
    this.storedEvent = storedEvent;
  }

  async getEvent(accountId: string, eventId: string) {
    if (
      accountId !== this.storedEvent.account_id ||
      eventId !== this.storedEvent.id
    ) {
      return null;
    }
    return { ...this.storedEvent };
  }

  async getConfig(accountId: string) {
    return accountId === this.storedEvent.account_id ? this.storedConfig : null;
  }

  async getAttribution(accountId: string, attributionId: string) {
    return accountId === this.storedEvent.account_id &&
      attributionId === this.storedAttribution?.id
      ? this.storedAttribution
      : null;
  }

  async getContact(accountId: string, contactId: string) {
    return accountId === this.storedEvent.account_id &&
      accountId === this.storedContact?.account_id &&
      contactId === this.storedContact?.id
      ? this.storedContact
      : null;
  }

  async markBeforeAttempt(
    accountId: string,
    eventId: string,
    expectedAttempts: number,
    status: Parameters<MetaConversionEventRepository['markBeforeAttempt']>[3],
    errorMessage: string
  ) {
    if (
      accountId !== this.storedEvent.account_id ||
      eventId !== this.storedEvent.id ||
      this.storedEvent.status !== 'pending' ||
      this.storedEvent.attempts !== expectedAttempts
    ) {
      return false;
    }
    this.storedEvent.status = status;
    this.preflightWrites.push({ status, errorMessage, expectedAttempts });
    return true;
  }

  async claimAttempt(
    accountId: string,
    eventId: string,
    expectedAttempts: number
  ) {
    if (
      accountId !== this.storedEvent.account_id ||
      eventId !== this.storedEvent.id ||
      this.storedEvent.status !== 'pending' ||
      this.storedEvent.attempts !== expectedAttempts
    ) {
      return false;
    }
    this.storedEvent.status = 'sending';
    this.storedEvent.attempts++;
    this.claims++;
    return true;
  }

  async persistAttemptResult(
    accountId: string,
    eventId: string,
    attempt: number,
    result: Parameters<MetaConversionEventRepository['persistAttemptResult']>[3]
  ) {
    if (
      accountId !== this.storedEvent.account_id ||
      eventId !== this.storedEvent.id ||
      this.storedEvent.status !== 'sending' ||
      this.storedEvent.attempts !== attempt
    ) {
      return false;
    }
    this.storedEvent.status = result.status;
    this.attemptResults.push({ attempt, ...result });
    return true;
  }

  async recoverStaleSending(staleBefore: string) {
    if (
      this.storedEvent.status !== 'sending' ||
      Date.parse(this.storedEvent.updated_at) >= Date.parse(staleBefore)
    ) {
      return 0;
    }
    this.storedEvent.status = 'delivery_unknown';
    this.recoveryWrites.push({
      status: 'delivery_unknown',
      error_message: 'delivery_unknown_worker_crash',
      staleBefore,
    });
    return 1;
  }

  async listPending(limit: number) {
    return this.pendingCandidates.slice(0, limit);
  }
}

function processOne(
  repository: MetaConversionEventRepository,
  deliver = vi.fn().mockResolvedValue(success)
) {
  return processMetaConversionEvent({
    repository,
    accountId: ACCOUNT,
    eventDbId: EVENT_DB_ID,
    decryptToken: (ciphertext) => {
      expect(ciphertext).toBe(TOKEN_CIPHERTEXT);
      return 'EA_DECRYPTED_CONVERSION_TOKEN';
    },
    deliver,
    now: () => new Date('2026-09-11T12:40:00.000Z'),
  });
}

function selectActualPending(repository: MemoryRepository) {
  // Mirror the production query's status=pending predicate, instead of the
  // legacy fixture's static candidate list. Repository query predicates are
  // also asserted independently below.
  vi.spyOn(repository, 'listPending').mockImplementation(async (limit) =>
    repository.storedEvent.status === 'pending'
      ? [{ id: repository.storedEvent.id, account_id: ACCOUNT }].slice(0, limit)
      : []
  );
}

function transportBatch(
  repository: MemoryRepository,
  fetcher: typeof fetch,
  timestamp = '2026-09-11T12:40:00.000Z'
) {
  return processMetaConversionEventBatch({
    repository,
    now: () => new Date(timestamp),
    processOne: (candidate) => processMetaConversionEvent({
      repository,
      accountId: candidate.account_id,
      eventDbId: candidate.id,
      decryptToken: () => 'EA_DECRYPTED_CONVERSION_TOKEN',
      deliver: (input) => sendMetaConversionEvent({ ...input, fetcher }),
      now: () => new Date(timestamp),
    }),
  });
}

describe('Delivery certainty: real client with mocked transport and repeat batches', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [200, { events_received: 1 }, 'sent'],
    [400, { error: { code: 100, error_subcode: 2804132, message: 'Invalid parameter' } }, 'failed'],
    [401, { error: { code: 190 } }, 'failed'],
    [403, { error: { code: 200 } }, 'failed'],
    [429, { error: { code: 613 } }, 'delivery_unknown'],
    [500, { error: { code: 1 } }, 'delivery_unknown'],
    [502, {}, 'delivery_unknown'],
    [503, {}, 'delivery_unknown'],
    [504, {}, 'delivery_unknown'],
    [200, {}, 'delivery_unknown'],
    [200, { events_received: 0 }, 'delivery_unknown'],
    [202, {}, 'delivery_unknown'],
    [200, [], 'delivery_unknown'],
    [200, { events_received: 1, error: { code: 4 } }, 'delivery_unknown'],
  ] as const)(
    'HTTP %i response %# has one attempt, terminal %s and zero second-pass POSTs',
    async (httpStatus, body, expectedStatus) => {
      const repository = new MemoryRepository();
      selectActualPending(repository);
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(body), { status: httpStatus })
      );

      const first = await transportBatch(repository, fetcher);
      expect(first.scanned).toBe(1);
      expect(first[expectedStatus]).toBe(1);
      expect(repository.storedEvent).toMatchObject({ status: expectedStatus, attempts: 1 });
      expect(repository.attemptResults[0]).toMatchObject({
        status: expectedStatus, meta_http_status: httpStatus, attempt: 1,
        sent_at: expectedStatus === 'sent' ? '2026-09-11T12:40:00.000Z' : null,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error' });

      const second = await transportBatch(repository, fetcher);
      expect(second.scanned).toBe(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(repository.storedEvent.attempts).toBe(1);
      expect(repository.claims).toBe(1);
      expect(repository.storedEvent.status).toBe(expectedStatus);
    }
  );

  it.each(['AbortError', 'TimeoutError', 'ECONNRESET'])(
    '%s after transport starts is terminal and not selected in the next batch',
    async (name) => {
      const repository = new MemoryRepository();
      selectActualPending(repository);
      const fetcher = vi.fn<typeof fetch>().mockRejectedValue(
        Object.assign(new Error('private transport contents'), { name })
      );
      await transportBatch(repository, fetcher);
      expect(repository.storedEvent).toMatchObject({ status: 'delivery_unknown', attempts: 1 });
      expect(repository.attemptResults[0]).toMatchObject({
        sent_at: null, meta_http_status: null,
        error_message: name === 'ECONNRESET'
          ? 'delivery_unknown_network' : 'delivery_unknown_timeout',
      });
      expect((await transportBatch(repository, fetcher)).scanned).toBe(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(repository.storedEvent.attempts).toBe(1);
    }
  );

  it.each([200, 503])('unparseable HTTP %i never retries', async (httpStatus) => {
    const repository = new MemoryRepository();
    selectActualPending(repository);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html>not JSON</html>', { status: httpStatus })
    );
    await transportBatch(repository, fetcher);
    expect(repository.storedEvent).toMatchObject({ status: 'delivery_unknown', attempts: 1 });
    expect((await transportBatch(repository, fetcher)).scanned).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('a pending/sent/failed/delivery_unknown fleet sends only the pending row', async () => {
    const repositories = ['pending', 'sent', 'failed', 'delivery_unknown'].map(
      (status, index) => new MemoryRepository(event({
        id: `row-${index}`, status: status as StoredMetaConversionEvent['status'],
        attempts: index === 0 ? 0 : 1,
      }))
    );
    const repository = repositories[0];
    vi.spyOn(repository, 'listPending').mockImplementation(async (limit) => repositories
      .filter((item) => item.storedEvent.status === 'pending')
      .map((item) => ({ id: item.storedEvent.id, account_id: ACCOUNT })).slice(0, limit));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 })
    );
    await transportBatch(repository, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(repositories.map((item) => item.claims)).toEqual([1, 0, 0, 0]);
    expect(repositories.map((item) => item.storedEvent.status))
      .toEqual(['sent', 'sent', 'failed', 'delivery_unknown']);
    expect((await transportBatch(repository, fetcher)).scanned).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('concurrent workers have one CAS winner and exactly one mocked HTTP POST', async () => {
    const repository = new MemoryRepository();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      await Promise.resolve();
      return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
    });
    const worker = () => processMetaConversionEvent({
      repository, accountId: ACCOUNT, eventDbId: EVENT_DB_ID,
      decryptToken: () => 'fictitious-token',
      deliver: (input) => sendMetaConversionEvent({ ...input, fetcher }),
    });
    const results = await Promise.all([worker(), worker()]);
    expect(results).toEqual(expect.arrayContaining([
      { status: 'sent', attempt: 1 }, { status: 'busy' },
    ]));
    expect(repository.claims).toBe(1);
    expect(repository.storedEvent.attempts).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('failed persistence after POST leaves sending, then terminal recovery without another POST', async () => {
    const repository = new MemoryRepository();
    selectActualPending(repository);
    vi.spyOn(repository, 'persistAttemptResult').mockRejectedValueOnce(new Error('private failure'));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 })
    );
    expect((await transportBatch(repository, fetcher)).errors).toBe(1);
    expect(repository.storedEvent).toMatchObject({ status: 'sending', attempts: 1 });
    // Reflect the real claim timestamp; only recover after the 30s lease.
    repository.storedEvent.updated_at = '2026-09-11T12:40:00.000Z';
    expect((await transportBatch(repository, fetcher)).recovered_sending).toBe(0);
    expect(repository.storedEvent.status).toBe('sending');
    const recovered = await transportBatch(repository, fetcher, '2026-09-11T12:41:00.000Z');
    expect(recovered.recovered_sending).toBe(1);
    expect(recovered.scanned).toBe(0);
    expect(repository.storedEvent).toMatchObject({ status: 'delivery_unknown', attempts: 1 });
    expect((await transportBatch(repository, fetcher)).scanned).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('logs retain operational identifiers/codes, never customer PII, hashes or secrets', async () => {
    const repository = new MemoryRepository();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 613, error_subcode: 33, message: 'private upstream message' },
    }), { status: 429 }));
    await transportBatch(repository, fetcher);
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).toContain('delivery_unknown');
    expect(logs).toContain(repository.storedEvent.event_id);
    const entry = vi.mocked(console.info).mock.calls[0][1];
    expect(entry).toMatchObject({
      event_name: 'LeadSubmitted', attempt: 1, http_status: 429,
      meta_error_code: 613, meta_error_subcode: 33, result: 'delivery_unknown',
    });
    for (const value of [contact().phone, contact().email!, contact().name!,
      sha256ForMeta('test.user@example.com'), sha256ForMeta('14155551212'),
      sha256ForMeta('maria'), sha256ForMeta('silva'), attribution().ctwa_clid,
      'EA_DECRYPTED_CONVERSION_TOKEN', TOKEN_CIPHERTEXT, 'Authorization']) {
      expect(logs).not.toContain(value);
    }
  });
});

describe('Meta conversion payload snapshots', () => {
  it.each(['LeadSubmitted', 'QualifiedLead'] as const)(
    'builds %s with hashed customer data and no financial data',
    (eventName) => {
      const payload = buildMetaConversionPayload(
        event({
          event_name: eventName,
          event_id: `stable-${eventName}`,
          value: 999.99,
          currency: 'BRL',
        }),
        attribution(),
        contact()
      );

      expect(payload).toEqual({
        data: [
          {
            event_name: eventName,
            event_time: 1_789_130_096,
            event_id: `stable-${eventName}`,
            action_source: 'business_messaging',
            messaging_channel: 'whatsapp',
            user_data: {
              whatsapp_business_account_id: 'waba-snapshot-1',
              ctwa_clid: 'CtWa_RAW_keep-byte-for-byte',
              em: [sha256ForMeta('test.user@example.com')],
              ph: [sha256ForMeta('14155551212')],
              fn: [sha256ForMeta('maria')],
              ln: [sha256ForMeta('silva')],
            },
          },
        ],
      });
      expect(JSON.stringify(payload)).not.toContain('custom_data');
      for (const key of ['em', 'ph', 'fn', 'ln'] as const) {
        expect(payload?.data[0].user_data[key]?.[0]).toMatch(HASH);
      }
    }
  );

  it('builds Purchase from frozen decimal and currency snapshots', () => {
    const payload = buildMetaConversionPayload(
      event({
        event_name: 'Purchase',
        event_id: 'stable-purchase-id',
        value: '1250.50',
        currency: 'BRL',
      }),
      attribution(),
      contact()
    );

    expect(payload).toEqual({
      data: [
        {
          event_name: 'Purchase',
          event_time: 1_789_130_096,
          event_id: 'stable-purchase-id',
          action_source: 'business_messaging',
          messaging_channel: 'whatsapp',
          user_data: {
            whatsapp_business_account_id: 'waba-snapshot-1',
            ctwa_clid: 'CtWa_RAW_keep-byte-for-byte',
            em: [sha256ForMeta('test.user@example.com')],
            ph: [sha256ForMeta('14155551212')],
            fn: [sha256ForMeta('maria')],
            ln: [sha256ForMeta('silva')],
          },
          custom_data: { value: 1250.5, currency: 'BRL' },
        },
      ],
    });
    for (const key of ['em', 'ph', 'fn', 'ln'] as const) {
      expect(payload?.data[0].user_data[key]?.[0]).toMatch(HASH);
    }
  });

  it.each([
    ['12.345', 'BRL'],
    ['not-a-number', 'BRL'],
    [Number.NaN, 'BRL'],
    [-1, 'BRL'],
    ['10.00', 'brl'],
    ['10.00', 'REAL'],
  ])('rejects invalid Purchase snapshot %s/%s', (value, currency) => {
    expect(
      buildMetaConversionPayload(
        event({ event_name: 'Purchase', value, currency }),
        attribution()
      )
    ).toBeNull();
  });

  it('preserves historical WABA and ctwa_clid bytes exactly', () => {
    const payload = buildMetaConversionPayload(
      event(),
      attribution({ waba_id: ' WABA snapshot ', ctwa_clid: ' CtWa Raw Value ' })
    );

    expect(payload?.data[0].user_data).toEqual({
      whatsapp_business_account_id: ' WABA snapshot ',
      ctwa_clid: ' CtWa Raw Value ',
    });
  });

  it('does not leak contact PII into the serialized payload', () => {
    const storedContact = contact();
    const payload = buildMetaConversionPayload(
      event(),
      attribution(),
      storedContact
    );
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain(String(storedContact.email));
    expect(serialized).not.toContain(String(storedContact.phone));
    expect(serialized).not.toContain(String(storedContact.name));
    expect(serialized).not.toContain('test.user@example.com');
    expect(serialized).not.toContain('14155551212');
    expect(serialized).not.toContain('maria');
    expect(serialized).not.toContain('silva');
    expect(serialized).toContain(sha256ForMeta('test.user@example.com'));
    expect(serialized).toContain(sha256ForMeta('14155551212'));
  });

  it('builds normally when the contact only has a phone', () => {
    const payload = buildMetaConversionPayload(
      event(),
      attribution(),
      contact({ email: null, name: null })
    );

    expect(payload?.data[0].user_data).toMatchObject({
      whatsapp_business_account_id: 'waba-snapshot-1',
      ctwa_clid: 'CtWa_RAW_keep-byte-for-byte',
      ph: [sha256ForMeta('14155551212')],
    });
    expect(payload?.data[0].user_data).not.toHaveProperty('em');
    expect(payload?.data[0].user_data).not.toHaveProperty('fn');
    expect(payload?.data[0].user_data).not.toHaveProperty('ln');
  });
});

describe('Meta conversion event processing', () => {
  it('claims immediately before one external request and persists success', async () => {
    const repository = new MemoryRepository();
    const deliver = vi.fn().mockImplementation(async () => {
      expect(repository.storedEvent.attempts).toBe(1);
      expect(repository.storedEvent.status).toBe('sending');
      return success;
    });

    await expect(processOne(repository, deliver)).resolves.toEqual({
      status: 'sent',
      attempt: 1,
    });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith({
      datasetId: 'dataset-1',
      accessToken: 'EA_DECRYPTED_CONVERSION_TOKEN',
      payload: expect.objectContaining({
        data: [expect.objectContaining({ event_id: event().event_id })],
      }),
    });
    expect(repository.attemptResults).toEqual([
      {
        attempt: 1,
        status: 'sent',
        sent_at: '2026-09-11T12:40:00.000Z',
        meta_http_status: 200,
        meta_response: { events_received: 1, fbtrace_id: 'trace-1' },
        error_message: null,
      },
    ]);
  });

  it('sends normally when the canonical contact has no email or name', async () => {
    const repository = new MemoryRepository();
    repository.storedContact = contact({ email: null, name: null });
    const deliver = vi.fn().mockResolvedValue(success);

    await expect(processOne(repository, deliver)).resolves.toEqual({
      status: 'sent',
      attempt: 1,
    });
    expect(deliver.mock.calls[0][0].payload.data[0].user_data).toEqual({
      whatsapp_business_account_id: 'waba-snapshot-1',
      ctwa_clid: 'CtWa_RAW_keep-byte-for-byte',
      ph: [sha256ForMeta('14155551212')],
    });
  });

  it('keeps hashed customer data optional when the attribution contact is unavailable', async () => {
    const repository = new MemoryRepository();
    repository.storedContact = null;
    const deliver = vi.fn().mockResolvedValue(success);

    await expect(processOne(repository, deliver)).resolves.toEqual({
      status: 'sent',
      attempt: 1,
    });
    expect(deliver.mock.calls[0][0].payload.data[0].user_data).toEqual({
      whatsapp_business_account_id: 'waba-snapshot-1',
      ctwa_clid: 'CtWa_RAW_keep-byte-for-byte',
    });
  });

  it.each([
    [null, 'skipped_missing_config'],
    [config({ dataset_id: null }), 'skipped_missing_config'],
    [config({ access_token: null }), 'skipped_missing_config'],
    [config({ enabled: false }), 'skipped_disabled'],
  ] as const)('preflight handles config %#', async (storedConfig, status) => {
    const repository = new MemoryRepository();
    repository.storedConfig = storedConfig;
    const deliver = vi.fn();

    await expect(processOne(repository, deliver)).resolves.toEqual({ status });
    expect(deliver).not.toHaveBeenCalled();
    expect(repository.storedEvent.attempts).toBe(0);
  });

  it.each([
    [event({ attribution_id: null }), attribution()],
    [event(), null],
    [event(), attribution({ ctwa_clid: '   ' })],
    [event(), attribution({ waba_id: null })],
  ])('skips missing or invalid exact attribution %#', async (stored, attr) => {
    const repository = new MemoryRepository(stored);
    repository.storedAttribution = attr;
    const deliver = vi.fn();

    await expect(processOne(repository, deliver)).resolves.toEqual({
      status: 'skipped_no_attribution',
    });
    expect(deliver).not.toHaveBeenCalled();
    expect(repository.storedEvent.attempts).toBe(0);
  });

  it('fails safely when conversion token decryption fails', async () => {
    const repository = new MemoryRepository();
    const deliver = vi.fn();

    const result = await processMetaConversionEvent({
      repository,
      accountId: ACCOUNT,
      eventDbId: EVENT_DB_ID,
      decryptToken: () => {
        throw new Error('ciphertext and key details');
      },
      deliver,
    });

    expect(result).toEqual({ status: 'failed', attempt: null });
    expect(repository.preflightWrites[0]).toMatchObject({
      errorMessage: 'conversion_access_token_unavailable',
      expectedAttempts: 0,
    });
    expect(repository.storedEvent.attempts).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('fails an invalid Purchase locally without consuming an attempt', async () => {
    const repository = new MemoryRepository(
      event({ event_name: 'Purchase', value: '1250.999', currency: 'BRL' })
    );
    const deliver = vi.fn();

    await expect(processOne(repository, deliver)).resolves.toEqual({
      status: 'failed',
      attempt: null,
    });
    expect(repository.storedEvent.attempts).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('allows only one of two concurrent workers to send', async () => {
    const repository = new MemoryRepository();
    const deliver = vi.fn().mockResolvedValue(success);

    const results = await Promise.all([
      processOne(repository, deliver),
      processOne(repository, deliver),
    ]);

    expect(results).toEqual(
      expect.arrayContaining([
        { status: 'sent', attempt: 1 },
        { status: 'busy' },
      ])
    );
    expect(repository.claims).toBe(1);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('quarantines a legacy pending row with a prior attempt without HTTP', async () => {
    const repository = new MemoryRepository(
      event({ attempts: 1, updated_at: '2026-09-11T12:39:50.000Z' })
    );
    const deliver = vi.fn();

    await expect(processOne(repository, deliver)).resolves.toEqual({
      status: 'delivery_unknown',
      attempt: null,
    });
    expect(repository.claims).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
    expect(repository.storedEvent.attempts).toBe(1);
    expect(repository.preflightWrites[0]).toMatchObject({
      status: 'delivery_unknown',
      errorMessage: 'delivery_unknown_previous_attempt',
    });
  });

  it.each([
    [null, null, 'delivery_unknown_timeout'],
    [null, null, 'delivery_unknown_network'],
    [503, { error: { code: 1 } }, 'delivery_unknown_server_error'],
    [429, { error: { code: 613 } }, 'delivery_unknown_rate_limit'],
  ] as const)(
    'persists an ambiguous attempt as delivery_unknown (%s/%s/%s)',
    async (httpStatus, response, errorCode) => {
      const repository = new MemoryRepository();
      const deliver = vi.fn().mockResolvedValue({
        classification: 'DELIVERY_UNKNOWN',
        httpStatus,
        response,
        errorMessage: 'ambiguous response with a secret',
        errorCode,
      } satisfies MetaConversionDeliveryResult);

      await expect(processOne(repository, deliver)).resolves.toEqual({
        status: 'delivery_unknown',
        attempt: 1,
      });
      expect(repository.attemptResults[0]).toMatchObject({
        attempt: 1,
        status: 'delivery_unknown',
        sent_at: null,
        meta_http_status: httpStatus,
        meta_response: response,
        error_message: errorCode,
      });

      await expect(processOne(repository, deliver)).resolves.toEqual({
        status: 'ignored',
      });
      expect(deliver).toHaveBeenCalledTimes(1);
    }
  );

  it('turns an unexpected transport throw into delivery_unknown', async () => {
    const repository = new MemoryRepository();
    const deliver = vi.fn().mockRejectedValue(new Error('secret transport'));

    await expect(processOne(repository, deliver)).resolves.toEqual({
      status: 'delivery_unknown',
      attempt: 1,
    });
    expect(repository.attemptResults[0]).toMatchObject({
      status: 'delivery_unknown',
      error_message: 'delivery_unknown_network',
    });
  });

  it.each([400, 401, 403, 404])(
    'fails definite HTTP %i rejections on their first real request',
    async (httpStatus) => {
      const repository = new MemoryRepository();
      const deliver = vi.fn().mockResolvedValue({
        classification: 'DEFINITE_REJECTION',
        httpStatus,
        response: { error: { code: 100, error_subcode: 33 } },
        errorMessage:
          'Invalid Bearer EA_DECRYPTED_CONVERSION_TOKEN encrypted-conversion-token CtWa_RAW_keep-byte-for-byte',
      } satisfies MetaConversionDeliveryResult);

      await expect(processOne(repository, deliver)).resolves.toEqual({
        status: 'failed',
        attempt: 1,
      });
      expect(repository.attemptResults[0]).toMatchObject({
        status: 'failed',
        meta_http_status: httpStatus,
      });
      expect(JSON.stringify(repository.attemptResults)).not.toContain(
        'EA_DECRYPTED_CONVERSION_TOKEN'
      );
      expect(JSON.stringify(repository.attemptResults)).not.toContain(
        'encrypted-conversion-token'
      );
      expect(JSON.stringify(repository.attemptResults)).not.toContain(
        'CtWa_RAW_keep-byte-for-byte'
      );
    }
  );

  it.each([
    'sent',
    'sending',
    'failed',
    'delivery_unknown',
    'skipped_disabled',
    'skipped_missing_config',
    'skipped_no_attribution',
  ] as const)('never automatically resends %s', async (status) => {
    const repository = new MemoryRepository(event({ status }));
    const deliver = vi.fn();

    await expect(processOne(repository, deliver)).resolves.toEqual({
      status: 'ignored',
    });
    expect(deliver).not.toHaveBeenCalled();
    expect(repository.claims).toBe(0);
  });

  it('uses the exact persisted event_id on the single automatic attempt', async () => {
    const repository = new MemoryRepository(
      event({ event_id: 'immutable-audit-event-id' })
    );
    const deliver = vi.fn().mockResolvedValue(success);

    await processOne(repository, deliver);

    expect(deliver.mock.calls[0][0].payload.data[0].event_id).toBe(
      'immutable-audit-event-id'
    );
    expect(deliver.mock.calls[0][0].payload.data[0].event_time).toBe(
      1_789_130_096
    );
  });

  it('resolves dataset and conversion token independently per account', async () => {
    const repositoryA = new MemoryRepository();
    const repositoryB = new MemoryRepository(
      event({
        id: 'event-row-b',
        account_id: 'account-b',
        event_id: 'meta:account-b:deal-b:LeadSubmitted',
      })
    );
    repositoryB.storedConfig = config({
      account_id: 'account-b',
      dataset_id: 'dataset-b',
      access_token: 'ciphertext-b',
    });
    repositoryB.storedAttribution = attribution({ account_id: 'account-b' });
    const delivered: Array<{ datasetId: string; accessToken: string }> = [];
    const deliver = vi.fn().mockImplementation(async (input) => {
      delivered.push({
        datasetId: input.datasetId,
        accessToken: input.accessToken,
      });
      return success;
    });

    await processMetaConversionEvent({
      repository: repositoryA,
      accountId: ACCOUNT,
      eventDbId: EVENT_DB_ID,
      decryptToken: () => 'token-a',
      deliver,
    });
    await processMetaConversionEvent({
      repository: repositoryB,
      accountId: 'account-b',
      eventDbId: 'event-row-b',
      decryptToken: (ciphertext) => {
        expect(ciphertext).toBe('ciphertext-b');
        return 'token-b';
      },
      deliver,
    });

    expect(delivered).toEqual([
      { datasetId: 'dataset-1', accessToken: 'token-a' },
      { datasetId: 'dataset-b', accessToken: 'token-b' },
    ]);
  });
});

describe('Meta conversion event batch', () => {
  it('processes a bounded list sequentially and isolates item failures', async () => {
    const repository = new MemoryRepository();
    repository.recoveryWrites = [];
    repository.pendingCandidates = [
      { id: 'oldest', account_id: 'a' },
      { id: 'middle', account_id: 'b' },
      { id: 'newest', account_id: 'c' },
    ];
    const order: string[] = [];

    const summary = await processMetaConversionEventBatch({
      repository,
      batchSize: 2,
      processOne: async (candidate) => {
        order.push(candidate.id);
        if (candidate.id === 'oldest') throw { code: '08006' };
        return { status: 'sent', attempt: 1 };
      },
    });

    expect(order).toEqual(['oldest', 'middle']);
    expect(summary).toEqual({
      recovered_sending: 0,
      scanned: 2,
      sent: 1,
      failed: 0,
      delivery_unknown: 0,
      skipped_disabled: 0,
      skipped_missing_config: 0,
      skipped_no_attribution: 0,
      busy: 0,
      ignored: 0,
      not_found: 0,
      errors: 1,
    });
  });

  it('quarantines stale sending before listing pending work', async () => {
    const repository = new MemoryRepository(
      event({
        status: 'sending',
        attempts: 1,
        updated_at: '2026-09-11T12:39:00.000Z',
      })
    );
    repository.pendingCandidates = [];
    const processOne = vi.fn();

    const summary = await processMetaConversionEventBatch({
      repository,
      processOne,
      now: () => new Date('2026-09-11T12:40:00.000Z'),
    });

    expect(repository.storedEvent.status).toBe('delivery_unknown');
    expect(repository.storedEvent.attempts).toBe(1);
    expect(repository.recoveryWrites[0]).toMatchObject({
      error_message: 'delivery_unknown_worker_crash',
      staleBefore: '2026-09-11T12:39:30.000Z',
    });
    expect(processOne).not.toHaveBeenCalled();
    expect(summary.recovered_sending).toBe(1);
    expect(summary.delivery_unknown).toBe(1);
  });

  it('leaves recent sending untouched and does not send it', async () => {
    const repository = new MemoryRepository(
      event({
        status: 'sending',
        attempts: 1,
        updated_at: '2026-09-11T12:39:45.000Z',
      })
    );
    repository.pendingCandidates = [];
    const processOne = vi.fn();

    const summary = await processMetaConversionEventBatch({
      repository,
      processOne,
      now: () => new Date('2026-09-11T12:40:00.000Z'),
    });

    expect(repository.storedEvent.status).toBe('sending');
    expect(repository.recoveryWrites).toEqual([]);
    expect(processOne).not.toHaveBeenCalled();
    expect(summary.recovered_sending).toBe(0);
    expect(summary.delivery_unknown).toBe(0);
  });
});

describe('Meta conversion repository selection', () => {
  it('resolves the attribution contact id with account scoping', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: attribution(),
      error: null,
    });
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const db = {
      from: vi.fn().mockReturnValue(query),
    } as unknown as SupabaseClient;

    await expect(
      createMetaConversionEventRepository(db).getAttribution(
        ACCOUNT,
        'attribution-1'
      )
    ).resolves.toEqual(attribution());
    expect(db.from).toHaveBeenCalledWith('meta_ad_attributions');
    expect(query.select).toHaveBeenCalledWith(
      'id,account_id,contact_id,ctwa_clid,waba_id'
    );
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', 'attribution-1');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'account_id', ACCOUNT);
  });

  it('resolves the canonical contact with account scoping', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: contact(),
      error: null,
    });
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const db = {
      from: vi.fn().mockReturnValue(query),
    } as unknown as SupabaseClient;

    await expect(
      createMetaConversionEventRepository(db).getContact(ACCOUNT, 'contact-1')
    ).resolves.toEqual(contact());
    expect(db.from).toHaveBeenCalledWith('contacts');
    expect(query.select).toHaveBeenCalledWith('id,account_id,phone,email,name');
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', 'contact-1');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'account_id', ACCOUNT);
  });

  it('claims with one pending-to-sending compare-and-set', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: EVENT_DB_ID },
      error: null,
    });
    const query = {
      update: vi.fn(),
      eq: vi.fn(),
      select: vi.fn(),
      maybeSingle,
    };
    query.update.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.select.mockReturnValue(query);
    const db = {
      from: vi.fn().mockReturnValue(query),
    } as unknown as SupabaseClient;

    await expect(
      createMetaConversionEventRepository(db).claimAttempt(
        ACCOUNT,
        EVENT_DB_ID,
        0
      )
    ).resolves.toBe(true);

    expect(query.update).toHaveBeenCalledWith({
      status: 'sending',
      attempts: 1,
      error_message: null,
    });
    expect(query.eq.mock.calls).toEqual([
      ['id', EVENT_DB_ID],
      ['account_id', ACCOUNT],
      ['status', 'pending'],
      ['attempts', 0],
    ]);
    expect(query.select).toHaveBeenCalledWith('id');
  });

  it('recovers only stale sending rows without clearing audit fields', async () => {
    const select = vi.fn().mockResolvedValue({
      data: [{ id: EVENT_DB_ID }],
      error: null,
    });
    const query = {
      update: vi.fn(),
      eq: vi.fn(),
      lt: vi.fn(),
      select,
    };
    query.update.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.lt.mockReturnValue(query);
    const db = {
      from: vi.fn().mockReturnValue(query),
    } as unknown as SupabaseClient;
    const cutoff = '2026-09-11T12:39:30.000Z';

    await expect(
      createMetaConversionEventRepository(db).recoverStaleSending(cutoff)
    ).resolves.toBe(1);

    expect(query.update).toHaveBeenCalledWith({
      status: 'delivery_unknown',
      error_message: 'delivery_unknown_worker_crash',
    });
    expect(query.eq).toHaveBeenCalledWith('status', 'sending');
    expect(query.lt).toHaveBeenCalledWith('updated_at', cutoff);
    expect(query.select).toHaveBeenCalledWith('id');
  });

  it('selects only pending rows in deterministic oldest-first order', async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{ id: EVENT_DB_ID, account_id: ACCOUNT }],
      error: null,
    });
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    const db = {
      from: vi.fn().mockReturnValue(query),
    } as unknown as SupabaseClient;

    const result = await createMetaConversionEventRepository(db).listPending(5);

    expect(result).toEqual([{ id: EVENT_DB_ID, account_id: ACCOUNT }]);
    expect(db.from).toHaveBeenCalledWith('meta_conversion_events');
    expect(query.eq).toHaveBeenCalledWith('status', 'pending');
    expect(query.order).toHaveBeenNthCalledWith(1, 'created_at', {
      ascending: true,
    });
    expect(query.order).toHaveBeenNthCalledWith(2, 'id', { ascending: true });
    expect(limit).toHaveBeenCalledWith(5);
  });

  it('does not select the Marketing token for conversion delivery', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: config(),
      error: null,
    });
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const db = {
      from: vi.fn().mockReturnValue(query),
    } as unknown as SupabaseClient;

    await createMetaConversionEventRepository(db).getConfig(ACCOUNT);

    const selected = String(query.select.mock.calls[0][0]);
    expect(selected).toContain('access_token');
    expect(selected).not.toContain('marketing_access_token');
    expect(query.eq).toHaveBeenCalledWith('account_id', ACCOUNT);
  });
});

describe('21G: privileged Meta sender fails closed on foreign rows', () => {
  it.each(['config','attribution','contact'] as const)('rejects foreign %s before claim/decrypt/transport',async(resource)=>{
    const repository=new MemoryRepository();
    if(resource==='config') repository.storedConfig=config({account_id:'account-B',dataset_id:'dataset-B'});
    if(resource==='attribution') repository.storedAttribution=attribution({account_id:'account-B',waba_id:'waba-B'});
    if(resource==='contact') repository.getContact=async()=>contact({account_id:'account-B'});
    const deliver=vi.fn(),decryptToken=vi.fn();
    await expect(processMetaConversionEvent({
      repository,accountId:ACCOUNT,eventDbId:EVENT_DB_ID,deliver,decryptToken,
    })).resolves.toEqual({status:'failed',attempt:null});
    expect(repository.claims).toBe(0);expect(deliver).not.toHaveBeenCalled();expect(decryptToken).not.toHaveBeenCalled();
  });
  it('concurrent A/B payloads contain only their own WABA and original CTWA',async()=>{
    const A=new MemoryRepository(),B=new MemoryRepository(event({id:'event-B',account_id:'account-B'}));
    B.storedConfig=config({account_id:'account-B',dataset_id:'dataset-B'});
    B.storedAttribution=attribution({account_id:'account-B',waba_id:'waba-B',ctwa_clid:'ctwa-B'});
    B.storedContact=null;
    const deliver=vi.fn().mockResolvedValue(success);
    await Promise.all([
      processOne(A,deliver),
      processMetaConversionEvent({repository:B,accountId:'account-B',eventDbId:'event-B',decryptToken:()=> 'token-B',deliver}),
    ]);
    const requests=deliver.mock.calls.map(([request])=>({dataset:request.datasetId,waba:request.payload.data[0].user_data.whatsapp_business_account_id,ctwa:request.payload.data[0].user_data.ctwa_clid}));
    expect(requests).toEqual(expect.arrayContaining([
      {dataset:'dataset-1',waba:'waba-snapshot-1',ctwa:'CtWa_RAW_keep-byte-for-byte'},
      {dataset:'dataset-B',waba:'waba-B',ctwa:'ctwa-B'},
    ]));
    expect(requests).toHaveLength(2);
  });
});
