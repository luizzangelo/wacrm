import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getCurrentAccount: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  status: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  getCurrentAccount: mocks.getCurrentAccount,
  toErrorResponse: () =>
    Response.json({ error: 'auth_error' }, { status: 401 }),
}));
vi.mock('@/lib/meta-conversions/admin-client', () => ({
  metaConversionsAdmin: () => ({}),
}));
vi.mock('@/lib/meta-ads/service', () => ({
  connectMetaAds: mocks.connect,
  disconnectMetaAds: mocks.disconnect,
  getMetaAdsStatus: mocks.status,
}));
vi.mock('@/lib/meta-ads/config', () => ({
  getMetaAdsServerConfig: () => ({
    appId: '12345',
    loginConfigId: '67890',
    graphVersion: 'v21.0',
    appSecret: 'hidden',
  }),
}));

import { POST as connectPost } from './connect/route';
import { POST as disconnectPost } from './disconnect/route';
import { GET as statusGet } from './status/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ accountId: 'workspace-a' });
  mocks.getCurrentAccount.mockResolvedValue({ accountId: 'workspace-a' });
  mocks.connect.mockResolvedValue({
    connected: true,
    adAccount: { id: 'act_12345', name: 'Main' },
  });
  mocks.status.mockResolvedValue({
    connected: false,
    source: null,
    adAccount: null,
    connectedAt: null,
  });
});

describe('Meta Ads routes', () => {
  it('requires admin and derives the workspace on connect', async () => {
    const response = await connectPost(
      new Request('https://crm.example/api/meta-ads/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'single-use-code' }),
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    expect(mocks.connect).toHaveBeenCalledWith(
      expect.anything(),
      'workspace-a',
      {
        code: 'single-use-code',
        adAccountId: undefined,
      }
    );
    expect(JSON.stringify(await response.json())).not.toContain('token');
  });

  it('requires admin on disconnect', async () => {
    expect((await disconnectPost()).status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    expect(mocks.disconnect).toHaveBeenCalledWith(
      expect.anything(),
      'workspace-a'
    );
  });

  it('returns only public SDK configuration and safe workspace status', async () => {
    const response = await statusGet();
    const payload = await response.json();
    expect(mocks.status).toHaveBeenCalledWith(expect.anything(), 'workspace-a');
    expect(payload.sdkConfig).toEqual({
      appId: '12345',
      configId: '67890',
      version: 'v21.0',
    });
    expect(JSON.stringify(payload)).not.toContain('hidden');
  });
});
