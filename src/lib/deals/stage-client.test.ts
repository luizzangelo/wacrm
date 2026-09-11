import { describe, expect, it, vi } from 'vitest';

import type { Deal } from '@/types';
import {
  DealStageRequestError,
  applyOptimisticDealStage,
  requestDealStageMove,
  requestDealStageMoveWithRefresh,
} from './stage-client';

function deal(id: string, stageId: string): Deal {
  return {
    id,
    user_id: 'user-a',
    pipeline_id: 'pipeline-a',
    stage_id: stageId,
    contact_id: 'contact-a',
    title: `Deal ${id}`,
    value: 100,
    currency: 'BRL',
    status: 'open',
    created_at: '2026-09-11T00:00:00.000Z',
  };
}

describe('deal stage client', () => {
  it('applies an immediate optimistic move without changing other deals', () => {
    const original = [deal('deal-a', 'stage-a'), deal('deal-b', 'stage-a')];

    const moved = applyOptimisticDealStage(original, 'deal-a', 'stage-b');

    expect(moved.map((item) => [item.id, item.stage_id])).toEqual([
      ['deal-a', 'stage-b'],
      ['deal-b', 'stage-a'],
    ]);
    expect(original[0].stage_id).toBe('stage-a');
  });

  it('moves through the authenticated dashboard endpoint only', async () => {
    const result = {
      changed: true as const,
      oldStageId: 'stage-a',
      newStageId: 'stage-b',
      deal: { id: 'deal-a' },
      newStage: { id: 'stage-b' },
    };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(result));

    await expect(
      requestDealStageMove('deal-a', 'stage-b', fetcher)
    ).resolves.toMatchObject(result);
    expect(fetcher).toHaveBeenCalledWith('/api/deals/deal-a/stage', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId: 'stage-b' }),
    });
    expect(fetcher.mock.calls[0][0]).not.toContain('graph.facebook.com');
  });

  it('surfaces a conflict so callers can refresh optimistic state', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: 'stage_conflict', currentStageId: 'stage-c' },
        { status: 409 }
      )
    );

    const error = await requestDealStageMove(
      'deal-a',
      'stage-b',
      fetcher
    ).catch((caught: unknown) => caught);

    expect(error).toEqual(
      new DealStageRequestError('stage_conflict', 409, 'stage-c')
    );
  });

  it('accepts a same-stage no-op as success', async () => {
    const result = {
      changed: false as const,
      reason: 'same_stage' as const,
      oldStageId: 'stage-b',
      newStageId: 'stage-b',
      deal: { id: 'deal-a' },
      newStage: { id: 'stage-b' },
    };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(result));

    await expect(
      requestDealStageMove('deal-a', 'stage-b', fetcher)
    ).resolves.toMatchObject({ changed: false, reason: 'same_stage' });
  });

  it('refreshes the board after a failed optimistic move', async () => {
    const conflict = new DealStageRequestError(
      'stage_conflict',
      409,
      'stage-c'
    );
    const requestMove = vi.fn<typeof requestDealStageMove>(async () => {
      throw conflict;
    });
    const refresh = vi.fn(async () => undefined);

    await expect(
      requestDealStageMoveWithRefresh('deal-a', 'stage-b', refresh, requestMove)
    ).rejects.toBe(conflict);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
