import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  allowed: true,
  requireRole: vi.fn(),
  row: {
    id: 'config-1',
    connection_mode: 'coexistence',
    status: 'connected',
  } as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
}));

function supabase() {
  return {
    from: () => {
      const result = { data: h.row, error: null };
      const chain: Record<string, unknown> = {};
      const self = chain as typeof chain & PromiseLike<typeof result>;
      for (const method of ['select', 'eq']) chain[method] = () => self;
      chain.update = (value: Record<string, unknown>) => {
        h.updates.push(value);
        return self;
      };
      chain.maybeSingle = async () => result;
      self.then = (resolve, reject) =>
        Promise.resolve(result).then(resolve, reject);
      return self;
    },
  };
}

vi.mock('@/lib/auth/request', () => ({ authRequestAllowed: () => h.allowed }));
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
vi.mock('@/lib/security/operational-log', () => ({
  operationalErrorFields: () => ({ error_kind: 'operation_failed' }),
}));

import { POST } from './route';

function request(confirm = true) {
  return new Request(
    'https://crm.example/api/whatsapp/embedded-signup/disconnect',
    {
      method: 'POST',
      headers: {
        origin: 'https://crm.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ confirm }),
    }
  );
}

beforeEach(() => {
  h.allowed = true;
  h.row = {
    id: 'config-1',
    connection_mode: 'coexistence',
    status: 'connected',
  };
  h.updates.length = 0;
  h.requireRole.mockResolvedValue({
    accountId: 'account-A',
    userId: 'user-A',
    supabase: supabase(),
  });
});

describe('coexistence disconnect', () => {
  it('requires admin authorization before any mutation', async () => {
    h.requireRole.mockRejectedValue({ status: 403 });
    expect((await POST(request())).status).toBe(403);
    expect(h.updates).toHaveLength(0);
  });

  it('requires explicit confirmation', async () => {
    expect((await POST(request(false))).status).toBe(400);
    expect(h.updates).toHaveLength(0);
  });

  it('marks coexistence disconnected without deleting history or credentials', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      disconnected: true,
      history_preserved: true,
      requires_business_app_action: true,
    });
    expect(h.updates[0]).toMatchObject({
      status: 'disconnected',
      disconnect_reason: 'user_requested_wacrm_disconnect',
      disconnect_initiated_by: 'user-A',
    });
    expect(h.updates[0]).not.toHaveProperty('access_token');
  });
});
