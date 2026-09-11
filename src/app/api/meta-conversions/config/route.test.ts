import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  getSafeConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 })
  ),
}));

vi.mock('@/lib/meta-conversions/admin-client', () => ({
  metaConversionsAdmin: vi.fn(() => ({ client: 'service-role' })),
}));

vi.mock('@/lib/meta-conversions/config', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/meta-conversions/config')>();
  return {
    ...actual,
    createMetaConversionsRepository: vi.fn(() => ({ repository: true })),
    getSafeMetaConversionConfig: mocks.getSafeConfig,
    saveMetaConversionConfig: mocks.saveConfig,
  };
});

import { GET, PATCH } from './route';

const safeConfig = {
  configured: true,
  enabled: false,
  dataset_id: 'dataset-1',
  has_access_token: true,
  has_marketing_access_token: false,
  whatsapp: {
    configured: true,
    waba_id: 'waba-1',
    phone_number_id: 'phone-1',
  },
};

function context(role: 'viewer' | 'agent' | 'admin' | 'owner') {
  return {
    accountId: 'account-a',
    userId: `${role}-user`,
    role,
    account: { id: 'account-a', name: 'Acme' },
    supabase: {},
  };
}

function patch(body: unknown) {
  return PATCH(
    new Request('http://localhost/api/meta-conversions/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  mocks.getCurrentAccount.mockReset();
  mocks.requireRole.mockReset();
  mocks.getSafeConfig.mockReset().mockResolvedValue(safeConfig);
  mocks.saveConfig.mockReset().mockResolvedValue(safeConfig);
});

describe('/api/meta-conversions/config authorization', () => {
  it('allows a viewer to GET only the safe workspace status', async () => {
    mocks.getCurrentAccount.mockResolvedValue(context('viewer'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(safeConfig);
    expect(body).not.toHaveProperty('access_token');
    expect(body).not.toHaveProperty('marketing_access_token');
    expect(mocks.getSafeConfig).toHaveBeenCalledWith(
      expect.anything(),
      'account-a'
    );
  });

  it.each(['viewer', 'agent'] as const)(
    'rejects %s writes before configuration code runs',
    async () => {
      mocks.requireRole.mockRejectedValue(new Error('insufficient role'));

      const response = await patch({ dataset_id: 'dataset-2' });

      expect(response.status).toBe(403);
      expect(mocks.requireRole).toHaveBeenCalledWith('admin');
      expect(mocks.saveConfig).not.toHaveBeenCalled();
    }
  );

  it.each(['admin', 'owner'] as const)('allows %s writes', async (role) => {
    mocks.requireRole.mockResolvedValue(context(role));

    const response = await patch({ dataset_id: 'dataset-2' });

    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    expect(mocks.saveConfig).toHaveBeenCalledWith(
      expect.anything(),
      'account-a',
      { dataset_id: 'dataset-2' }
    );
  });

  it('ignores a forged account_id and uses the authenticated workspace', async () => {
    mocks.requireRole.mockResolvedValue(context('admin'));

    await patch({ account_id: 'account-b', dataset_id: 'dataset-2' });

    expect(mocks.saveConfig).toHaveBeenCalledWith(
      expect.anything(),
      'account-a',
      { dataset_id: 'dataset-2' }
    );
  });
});
