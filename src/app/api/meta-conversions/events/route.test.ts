import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/auth/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/account')>()),
  requireRole: mocks.requireRole,
}));
vi.mock('@/lib/meta-conversions/event-diagnostics', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/meta-conversions/event-diagnostics')
  >()),
  listEventDiagnostics: mocks.list,
}));
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account';
import { GET } from './route';
const request = (query = '') =>
  new Request(`http://localhost/api/meta-conversions/events?${query}`);
beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.list.mockReset().mockResolvedValue({ events: [] });
});
describe('event diagnostic API', () => {
  it.each(['owner', 'admin'])(
    'allows %s using SSR/RLS and authenticated account only',
    async (role) => {
      const supabase = { rls: true };
      mocks.requireRole.mockResolvedValue({
        role,
        accountId: 'account-a',
        supabase,
      });
      const response = await GET(request('account_id=account-b&status=failed'));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(mocks.requireRole).toHaveBeenCalledWith('admin');
      expect(mocks.list).toHaveBeenCalledWith(
        supabase,
        'account-a',
        expect.objectContaining({ status: 'failed' })
      );
    }
  );
  it.each(['viewer', 'agent'])(
    'forbids %s before database access',
    async () => {
      mocks.requireRole.mockRejectedValue(new ForbiddenError());
      const response = await GET(request());
      expect(response.status).toBe(403);
      expect(mocks.list).not.toHaveBeenCalled();
    }
  );
  it('rejects unauthenticated users', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    expect((await GET(request())).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('rejects bad filters without echoing input', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'a', supabase: {} });
    const response = await GET(request('status=SECRET_INPUT'));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('SECRET_INPUT');
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('never exposes or logs database errors', async () => {
    const logger = vi.spyOn(console, 'error');
    mocks.requireRole.mockResolvedValue({ accountId: 'a', supabase: {} });
    mocks.list.mockRejectedValue(new Error('Authorization Bearer PRIVATE'));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('PRIVATE');
    expect(logger).not.toHaveBeenCalled();
    logger.mockRestore();
  });
});
