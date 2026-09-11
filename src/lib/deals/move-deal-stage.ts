import type { SupabaseClient } from '@supabase/supabase-js';

import type { DealStatus, MetaConversionEvent } from '@/types';

const DEAL_STAGE_SELECT =
  'id, user_id, account_id, pipeline_id, stage_id, contact_id, conversation_id, title, value, currency, assigned_to, notes, expected_close_date, status, meta_attribution_id, created_at, updated_at';

export interface DealStageSnapshot {
  id: string;
  user_id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  title: string;
  value: number;
  currency: string;
  assigned_to: string | null;
  notes: string | null;
  expected_close_date: string | null;
  status: DealStatus;
  meta_attribution_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ScopedDealStageSnapshot extends DealStageSnapshot {
  account_id: string;
}

export interface DealStageTarget {
  id: string;
  pipeline_id: string;
  meta_conversion_event: MetaConversionEvent | null;
}

export type MoveDealToStageResult =
  | {
      changed: false;
      reason: 'same_stage';
      oldStageId: string;
      newStageId: string;
      deal: DealStageSnapshot;
      newStage: DealStageTarget;
    }
  | {
      changed: true;
      oldStageId: string;
      newStageId: string;
      deal: DealStageSnapshot;
      newStage: DealStageTarget;
    };

export type DealStageMoveErrorCode =
  | 'deal_not_found'
  | 'stage_not_available'
  | 'invalid_current_stage'
  | 'stage_conflict'
  | 'database_error';

export class DealStageMoveError extends Error {
  constructor(
    readonly code: DealStageMoveErrorCode,
    readonly status: 404 | 409 | 500,
    readonly currentStageId?: string
  ) {
    super(code);
    this.name = 'DealStageMoveError';
  }
}

export interface DealStageRepository {
  findDeal(
    accountId: string,
    dealId: string
  ): Promise<DealStageSnapshot | null>;
  pipelineBelongsToAccount(
    accountId: string,
    pipelineId: string
  ): Promise<boolean>;
  findStages(
    pipelineId: string,
    stageIds: string[]
  ): Promise<DealStageTarget[]>;
  compareAndSetStage(input: {
    accountId: string;
    dealId: string;
    oldStageId: string;
    newStageId: string;
  }): Promise<DealStageSnapshot | null>;
}

export interface MoveDealToStageInput {
  accountId: string;
  actorUserId: string;
  dealId: string;
  newStageId: string;
}

function databaseError(operation: string, error: unknown): never {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'unknown';
  console.error('[deal-stage] database operation failed', { operation, code });
  throw new DealStageMoveError('database_error', 500);
}

function toDealStageSnapshot(row: ScopedDealStageSnapshot): DealStageSnapshot {
  const { account_id: accountId, ...deal } = row;
  void accountId;
  return deal;
}

export function createDealStageRepository(
  db: SupabaseClient
): DealStageRepository {
  return {
    async findDeal(accountId, dealId) {
      const { data, error } = await db
        .from('deals')
        .select(DEAL_STAGE_SELECT)
        .eq('id', dealId)
        .eq('account_id', accountId)
        .maybeSingle();

      if (error) databaseError('deal read', error);
      return data ? toDealStageSnapshot(data as ScopedDealStageSnapshot) : null;
    },

    async pipelineBelongsToAccount(accountId, pipelineId) {
      const { data, error } = await db
        .from('pipelines')
        .select('id')
        .eq('id', pipelineId)
        .eq('account_id', accountId)
        .maybeSingle();

      if (error) databaseError('pipeline read', error);
      return data !== null;
    },

    async findStages(pipelineId, stageIds) {
      const { data, error } = await db
        .from('pipeline_stages')
        .select('id, pipeline_id, meta_conversion_event')
        .eq('pipeline_id', pipelineId)
        .in('id', stageIds);

      if (error) databaseError('stage read', error);
      return (data ?? []) as DealStageTarget[];
    },

    async compareAndSetStage(input) {
      const { data, error } = await db
        .from('deals')
        .update({ stage_id: input.newStageId })
        .eq('id', input.dealId)
        .eq('account_id', input.accountId)
        .eq('stage_id', input.oldStageId)
        .select(DEAL_STAGE_SELECT)
        .maybeSingle();

      if (error) databaseError('deal compare-and-set', error);
      return data ? toDealStageSnapshot(data as ScopedDealStageSnapshot) : null;
    },
  };
}

/**
 * The single domain rule for transitioning an existing deal between stages.
 * Creation is intentionally not handled here: an initial stage is not a
 * transition and must remain part of the deal INSERT.
 */
export async function moveDealToStage(
  repository: DealStageRepository,
  input: MoveDealToStageInput
): Promise<MoveDealToStageResult> {
  const deal = await repository.findDeal(input.accountId, input.dealId);
  if (!deal) throw new DealStageMoveError('deal_not_found', 404);

  const validPipeline = await repository.pipelineBelongsToAccount(
    input.accountId,
    deal.pipeline_id
  );
  if (!validPipeline) {
    console.error('[deal-stage] deal references an unavailable pipeline', {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      dealId: input.dealId,
      pipelineId: deal.pipeline_id,
    });
    throw new DealStageMoveError('invalid_current_stage', 409);
  }

  const requestedStageIds =
    deal.stage_id === input.newStageId
      ? [deal.stage_id]
      : [deal.stage_id, input.newStageId];
  const stages = await repository.findStages(
    deal.pipeline_id,
    requestedStageIds
  );
  const oldStage = stages.find((stage) => stage.id === deal.stage_id);
  const newStage = stages.find((stage) => stage.id === input.newStageId);

  if (!oldStage) {
    console.error('[deal-stage] deal has an invalid current stage', {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      dealId: input.dealId,
      pipelineId: deal.pipeline_id,
      currentStageId: deal.stage_id,
    });
    throw new DealStageMoveError('invalid_current_stage', 409);
  }
  if (!newStage) {
    throw new DealStageMoveError('stage_not_available', 404);
  }

  if (deal.stage_id === input.newStageId) {
    return {
      changed: false,
      reason: 'same_stage',
      oldStageId: deal.stage_id,
      newStageId: input.newStageId,
      deal,
      newStage,
    };
  }

  const updatedDeal = await repository.compareAndSetStage({
    accountId: input.accountId,
    dealId: input.dealId,
    oldStageId: deal.stage_id,
    newStageId: input.newStageId,
  });

  if (updatedDeal) {
    return {
      changed: true,
      oldStageId: deal.stage_id,
      newStageId: input.newStageId,
      deal: updatedDeal,
      newStage,
    };
  }

  const currentDeal = await repository.findDeal(input.accountId, input.dealId);
  if (!currentDeal) throw new DealStageMoveError('deal_not_found', 404);

  // Another request may have moved the deal to this same target. This caller
  // did not perform that transition, so report a no-op instead of claiming it.
  if (currentDeal.stage_id === input.newStageId) {
    return {
      changed: false,
      reason: 'same_stage',
      oldStageId: currentDeal.stage_id,
      newStageId: input.newStageId,
      deal: currentDeal,
      newStage,
    };
  }

  console.warn('[deal-stage] concurrent stage transition rejected', {
    accountId: input.accountId,
    actorUserId: input.actorUserId,
    dealId: input.dealId,
    oldStageId: deal.stage_id,
    requestedStageId: input.newStageId,
    currentStageId: currentDeal.stage_id,
  });
  throw new DealStageMoveError('stage_conflict', 409, currentDeal.stage_id);
}
