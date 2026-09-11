import type { Deal } from '@/types';
import type { MoveDealToStageResult } from './move-deal-stage';

export class DealStageRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly currentStageId?: string
  ) {
    super(code);
    this.name = 'DealStageRequestError';
  }
}

export function applyOptimisticDealStage(
  deals: Deal[],
  dealId: string,
  newStageId: string
): Deal[] {
  return deals.map((deal) =>
    deal.id === dealId ? { ...deal, stage_id: newStageId } : deal
  );
}

function isMoveResult(value: unknown): value is MoveDealToStageResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'changed' in value &&
    typeof value.changed === 'boolean' &&
    'oldStageId' in value &&
    typeof value.oldStageId === 'string' &&
    'newStageId' in value &&
    typeof value.newStageId === 'string'
  );
}

export async function requestDealStageMove(
  dealId: string,
  newStageId: string,
  fetcher: typeof fetch = fetch
): Promise<MoveDealToStageResult> {
  const response = await fetcher(
    `/api/deals/${encodeURIComponent(dealId)}/stage`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId: newStageId }),
    }
  );
  const body = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const errorBody =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    throw new DealStageRequestError(
      typeof errorBody.error === 'string' ? errorBody.error : 'move_failed',
      response.status,
      typeof errorBody.currentStageId === 'string'
        ? errorBody.currentStageId
        : undefined
    );
  }

  if (!isMoveResult(body)) {
    throw new DealStageRequestError('invalid_response', 500);
  }
  return body;
}

export async function requestDealStageMoveWithRefresh(
  dealId: string,
  newStageId: string,
  refresh: () => Promise<unknown>,
  requestMove: typeof requestDealStageMove = requestDealStageMove
): Promise<MoveDealToStageResult> {
  try {
    return await requestMove(dealId, newStageId);
  } catch (error) {
    await refresh();
    throw error;
  }
}
