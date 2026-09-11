import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  validateStored: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
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
  };
});

vi.mock('@/lib/meta-conversions/validate', () => ({
  validateStoredMetaConversionConfig: mocks.validateStored,
}));

import { POST } from './route';

const validResult = {
  valid: true,
  read_only: true,
  token: { status: 'valid', http_status: 200 },
  dataset: {
    status: 'valid',
    http_status: 200,
    requested_id: 'dataset-1',
  },
  whatsapp: { status: 'valid', waba_id: 'waba-1', source: 'local' },
  marketing_token: { configured: false, status: 'not_checked' },
};

function context(role: 'admin' | 'owner') {
  return { accountId: 'account-a', role };
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.validateStored.mockReset().mockResolvedValue(validResult);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

describe('POST /api/meta-conversions/config/validate', () => {
  it('rejects non-admin validation before reading stored secrets', async () => {
    mocks.requireRole.mockRejectedValue(new Error('insufficient role'));

    const response = await POST();

    expect(response.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    expect(mocks.validateStored).not.toHaveBeenCalled();
  });

  it.each(['admin', 'owner'] as const)(
    'allows %s to run the read-only validation for its own account',
    async (role) => {
      mocks.requireRole.mockResolvedValue(context(role));

      const response = await POST();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.read_only).toBe(true);
      expect(mocks.validateStored).toHaveBeenCalledWith(
        expect.anything(),
        'account-a'
      );
    }
  );
});
