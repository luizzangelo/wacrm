import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  requestAllowed: true,
  requireRole: vi.fn(),
  from: vi.fn(),
  exchange: vi.fn(),
  validate: vi.fn(),
  discover: vi.fn(),
  subscribe: vi.fn(),
  sync: vi.fn(),
  encrypted: [] as string[],
  upserts: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  claimed: null as null | { account_id: string },
  pending: null as null | Record<string, unknown>,
}));

function query(table: string) {
  let result: { data: unknown; error: unknown } = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  const self = chain as typeof chain & PromiseLike<typeof result>;
  for (const method of ['select', 'eq', 'neq', 'is', 'lt', 'delete']) {
    chain[method] = vi.fn(() => self);
  }
  chain.insert = vi.fn((row: Record<string, unknown>) => {
    h.inserts.push(row);
    if (table === 'whatsapp_embedded_signup_sessions') {
      result = {
        data: { id: '70000000-0000-4000-8000-000000000001' },
        error: null,
      };
    }
    return self;
  });
  chain.upsert = vi.fn((row: Record<string, unknown>) => {
    h.upserts.push(row);
    return self;
  });
  chain.update = vi.fn((row: Record<string, unknown>) => {
    h.updates.push(row);
    return self;
  });
  chain.single = vi.fn(async () => result);
  chain.maybeSingle = vi.fn(async () => {
    if (table === 'whatsapp_config') return { data: h.claimed, error: null };
    if (table === 'whatsapp_embedded_signup_sessions') {
      return { data: h.pending, error: null };
    }
    return result;
  });
  self.then = (resolve, reject) =>
    Promise.resolve(result).then(resolve, reject);
  return self;
}

vi.mock('@/lib/auth/request', () => ({
  authRequestAllowed: () => h.requestAllowed,
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (error: { status?: number }) =>
    Response.json({ error: 'auth' }, { status: error.status ?? 500 }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({}, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: h.from }),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (value: string) => {
    h.encrypted.push(value);
    return `enc::${value}`;
  },
  decrypt: (value: string) => value.replace('enc::', ''),
}));
vi.mock('@/lib/whatsapp/embedded-signup-config', () => ({
  getEmbeddedSignupServerConfig: () => ({
    appId: '1661839952034827',
    configId: '1449663160367056',
    graphVersion: 'v26.0',
    appSecret: 'server-only',
  }),
}));
vi.mock('@/lib/whatsapp/embedded-signup-meta', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/whatsapp/embedded-signup-meta')
  >()),
  exchangeAuthorizationCode: h.exchange,
  validateAccessToken: h.validate,
  discoverWabaPhoneNumbers: h.discover,
  subscribeAndConfirmWaba: h.subscribe,
  requestCoexistenceSync: h.sync,
}));
vi.mock('@/lib/security/operational-log', () => ({
  operationalErrorFields: () => ({ error_kind: 'operation_failed' }),
}));

import { POST } from './route';
import { EmbeddedSignupMetaError } from '@/lib/whatsapp/embedded-signup-meta';

const PHONE = {
  id: '108261528923943',
  displayPhoneNumber: '+55 85 99999-0000',
  verifiedName: 'Example',
  isOnBizApp: true,
  platformType: 'CLOUD_API',
};

function request(body: unknown) {
  return new Request(
    'https://crm.example/api/whatsapp/embedded-signup/complete',
    {
      method: 'POST',
      headers: {
        origin: 'https://crm.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
}

beforeEach(() => {
  h.requestAllowed = true;
  h.requireRole.mockResolvedValue({ accountId: 'account-A', userId: 'user-A' });
  h.from.mockImplementation(query);
  h.exchange.mockResolvedValue({
    accessToken: 'business-token',
    tokenType: 'bearer',
    expiresAt: null,
  });
  h.validate.mockResolvedValue({
    scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
    granularWabaIds: ['2295585011204142'],
  });
  h.discover.mockResolvedValue([PHONE]);
  h.subscribe.mockResolvedValue(undefined);
  h.sync.mockResolvedValue('request-1');
  h.encrypted.length = 0;
  h.upserts.length = 0;
  h.inserts.length = 0;
  h.updates.length = 0;
  h.claimed = null;
  h.pending = null;
});

describe('POST Embedded Signup completion', () => {
  it('rejects cross-origin requests before auth or Meta calls', async () => {
    h.requestAllowed = false;
    expect((await POST(request({}))).status).toBe(403);
    expect(h.requireRole).not.toHaveBeenCalled();
    expect(h.exchange).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    'rejects account authorization status %s before exchange',
    async (status) => {
      h.requireRole.mockRejectedValue({ status });
      expect((await POST(request({}))).status).toBe(status);
      expect(h.exchange).not.toHaveBeenCalled();
    }
  );

  it('connects one validated coexistence phone without legacy registration', async () => {
    const response = await POST(
      request({
        kind: 'complete',
        code: 'authorization-code-123',
        waba_id: '2295585011204142',
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      connected: true,
      connection_mode: 'coexistence',
      subscription_status: 'subscribed',
    });
    expect(h.exchange).toHaveBeenCalledTimes(1);
    expect(h.subscribe).toHaveBeenCalledTimes(1);
    expect(h.sync).toHaveBeenCalledTimes(2);
    expect(h.sync.mock.calls.map((call) => call[3])).toEqual([
      'smb_app_state_sync',
      'history',
    ]);
    expect(h.upserts[0]).toMatchObject({
      account_id: 'account-A',
      phone_number_id: PHONE.id,
      access_token: 'enc::business-token',
      connection_mode: 'coexistence',
      registered_at: null,
    });
  });

  it('never associates a phone already claimed by another tenant', async () => {
    h.claimed = { account_id: 'account-B' };
    const response = await POST(
      request({
        kind: 'complete',
        code: 'authorization-code-123',
        waba_id: '2295585011204142',
      })
    );
    expect(response.status).toBe(409);
    expect(h.upserts).toHaveLength(0);
    expect(h.subscribe).not.toHaveBeenCalled();
  });

  it('rejects a WABA outside the token granular assets', async () => {
    h.validate.mockResolvedValue({
      scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
      granularWabaIds: ['999999999999999'],
    });
    const response = await POST(
      request({
        kind: 'complete',
        code: 'authorization-code-123',
        waba_id: '2295585011204142',
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_waba' });
    expect(h.discover).not.toHaveBeenCalled();
    expect(h.upserts).toHaveLength(0);
  });

  it('keeps a partial disconnected record when app subscription fails', async () => {
    h.subscribe.mockRejectedValue(
      new EmbeddedSignupMetaError('subscription_failed', 400, 100)
    );
    const response = await POST(
      request({
        kind: 'complete',
        code: 'authorization-code-123',
        waba_id: '2295585011204142',
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'subscription_failed',
      meta_code: 100,
    });
    expect(h.upserts[0]).toMatchObject({ status: 'disconnected' });
    expect(h.updates).toContainEqual(
      expect.objectContaining({
        status: 'disconnected',
        subscription_status: 'failed',
      })
    );
    expect(h.sync).not.toHaveBeenCalled();
  });

  it('escrows an encrypted token when multiple numbers require selection', async () => {
    h.discover.mockResolvedValue([
      PHONE,
      {
        ...PHONE,
        id: '108261528923944',
        displayPhoneNumber: '+55 85 99999-0001',
      },
    ]);
    const response = await POST(
      request({
        kind: 'complete',
        code: 'authorization-code-123',
        waba_id: '2295585011204142',
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      connected: false,
      requires_phone_selection: true,
    });
    expect(h.inserts[0]).toMatchObject({
      account_id: 'account-A',
      encrypted_access_token: 'enc::business-token',
      waba_id: '2295585011204142',
    });
    expect(JSON.stringify(h.inserts[0])).not.toContain('"business-token"');
    expect(h.upserts).toHaveLength(0);
  });

  it('revalidates an explicit selection from same-account encrypted escrow', async () => {
    h.pending = {
      id: '70000000-0000-4000-8000-000000000001',
      encrypted_access_token: 'enc::business-token',
      waba_id: '2295585011204142',
      meta_business_id: null,
      token_type: 'bearer',
      token_expires_at: null,
      candidates: [{ id: PHONE.id }],
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      consumed_at: null,
    };
    const response = await POST(
      request({
        kind: 'select',
        session_id: '70000000-0000-4000-8000-000000000001',
        phone_number_id: PHONE.id,
      })
    );
    expect(response.status).toBe(200);
    expect(h.exchange).not.toHaveBeenCalled();
    expect(h.validate).toHaveBeenCalledWith(
      expect.anything(),
      'business-token'
    );
    expect(h.upserts[0]).toMatchObject({
      account_id: 'account-A',
      phone_number_id: PHONE.id,
    });
    expect(h.updates).toContainEqual(
      expect.objectContaining({ consumed_at: expect.any(String) })
    );
  });
});
