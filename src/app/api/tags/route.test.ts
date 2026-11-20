import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 401 })
  ),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  toErrorResponse: mocks.toErrorResponse,
}));

import { GET } from './route';

function scopedTagsQuery(result: {
  data: Array<{ id: string; name: string; color: string | null }> | null;
  error: { message: string } | null;
}) {
  const order = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from }, from, select, eq, order };
}

beforeEach(() => {
  mocks.getCurrentAccount.mockReset();
  mocks.toErrorResponse.mockClear();
});

describe('GET /api/tags', () => {
  it('returns only tags from the authenticated account ordered by name', async () => {
    const query = scopedTagsQuery({
      data: [
        { id: 'tag-1', name: 'Cliente', color: '#7c3aed' },
        { id: 'tag-2', name: 'Lead', color: '#2563eb' },
      ],
      error: null,
    });
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: query.client,
      accountId: 'account-a',
      userId: 'user-a',
      role: 'agent',
      account: { id: 'account-a', name: 'Acme' },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      tags: [
        { id: 'tag-1', name: 'Cliente', color: '#7c3aed' },
        { id: 'tag-2', name: 'Lead', color: '#2563eb' },
      ],
    });
    expect(query.from).toHaveBeenCalledWith('tags');
    expect(query.select).toHaveBeenCalledWith('id, name, color');
    expect(query.eq).toHaveBeenCalledWith('account_id', 'account-a');
    expect(query.order).toHaveBeenCalledWith('name', { ascending: true });
  });

  it('rejects unauthenticated requests', async () => {
    const authError = new Error('Unauthorized');
    mocks.getCurrentAccount.mockRejectedValue(authError);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.toErrorResponse).toHaveBeenCalledWith(authError);
  });
});
