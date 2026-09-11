import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  metaConversionsAdmin: vi.fn(),
  createRepository: vi.fn(),
  moveDealToStage: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth_failed' }, { status: 403 })
  ),
}));

vi.mock('@/lib/deals/move-deal-stage', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/deals/move-deal-stage')>();
  return {
    ...actual,
    createDealStageRepository: mocks.createRepository,
    moveDealToStage: mocks.moveDealToStage,
  };
});

vi.mock('@/lib/meta-conversions/admin-client', () => ({
  metaConversionsAdmin: mocks.metaConversionsAdmin,
}));

import { DealStageMoveError } from '@/lib/deals/move-deal-stage';
import { PATCH } from './route';

const DEAL_ID = '11111111-1111-4111-8111-111111111111';
const STAGE_ID = '22222222-2222-4222-8222-222222222222';
const CURRENT_STAGE_ID = '33333333-3333-4333-8333-333333333333';

function context(role: 'agent' | 'admin' | 'owner') {
  return {
    supabase: { role },
    accountId: 'account-a',
    userId: `${role}-user`,
    role,
    account: { id: 'account-a', name: 'Acme' },
  };
}

function patch(body: unknown, dealId = DEAL_ID) {
  return PATCH(
    new Request(`http://localhost/api/deals/${dealId}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ dealId }) }
  );
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.metaConversionsAdmin.mockReset().mockReturnValue({ serviceRole: true });
  mocks.createRepository.mockReset().mockReturnValue({ repository: true });
  mocks.moveDealToStage.mockReset().mockResolvedValue({
    changed: true,
    oldStageId: CURRENT_STAGE_ID,
    newStageId: STAGE_ID,
    deal: { id: DEAL_ID, stage_id: STAGE_ID },
    newStage: { id: STAGE_ID },
  });
});

describe('PATCH /api/deals/[dealId]/stage', () => {
  it('rejects a viewer through the agent role gate', async () => {
    mocks.requireRole.mockRejectedValue(new Error('insufficient role'));

    const response = await patch({ stageId: STAGE_ID });

    expect(response.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('agent');
    expect(mocks.metaConversionsAdmin).not.toHaveBeenCalled();
    expect(mocks.moveDealToStage).not.toHaveBeenCalled();
  });

  it.each(['agent', 'admin', 'owner'] as const)(
    'allows the %s role to move a deal',
    async (role) => {
      const auth = context(role);
      mocks.requireRole.mockResolvedValue(auth);

      const response = await patch({ stageId: STAGE_ID });

      expect(response.status).toBe(200);
      expect(mocks.metaConversionsAdmin).toHaveBeenCalledOnce();
      expect(mocks.createRepository).toHaveBeenCalledWith({
        serviceRole: true,
      });
      expect(mocks.moveDealToStage).toHaveBeenCalledWith(
        { repository: true },
        {
          accountId: 'account-a',
          actorUserId: `${role}-user`,
          dealId: DEAL_ID,
          newStageId: STAGE_ID,
        }
      );
    }
  );

  it('ignores a forged account_id and uses only authenticated context', async () => {
    mocks.requireRole.mockResolvedValue(context('agent'));

    await patch({ stageId: STAGE_ID, account_id: 'account-b' });

    expect(mocks.moveDealToStage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accountId: 'account-a' })
    );
    expect(mocks.moveDealToStage.mock.calls[0][1]).not.toHaveProperty(
      'account_id'
    );
  });

  it.each([
    [{}, DEAL_ID],
    [{ stageId: 'not-a-uuid' }, DEAL_ID],
    [{ stageId: STAGE_ID }, 'not-a-uuid'],
  ] as const)('rejects invalid identifiers', async (body, dealId) => {
    mocks.requireRole.mockResolvedValue(context('agent'));

    const response = await patch(body, dealId);

    expect(response.status).toBe(400);
    expect(mocks.metaConversionsAdmin).not.toHaveBeenCalled();
    expect(mocks.moveDealToStage).not.toHaveBeenCalled();
  });

  it('returns a safe 409 response for a compare-and-set conflict', async () => {
    mocks.requireRole.mockResolvedValue(context('agent'));
    mocks.moveDealToStage.mockRejectedValue(
      new DealStageMoveError('stage_conflict', 409, CURRENT_STAGE_ID)
    );

    const response = await patch({ stageId: STAGE_ID });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'stage_conflict',
      currentStageId: CURRENT_STAGE_ID,
    });
  });

  it.each([
    ['deal_not_found', 404],
    ['stage_not_available', 404],
    ['invalid_current_stage', 409],
    ['database_error', 500],
  ] as const)('maps %s to a safe status', async (code, status) => {
    mocks.requireRole.mockResolvedValue(context('agent'));
    mocks.moveDealToStage.mockRejectedValue(
      new DealStageMoveError(code, status)
    );

    const response = await patch({ stageId: STAGE_ID });

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: code });
  });
});
