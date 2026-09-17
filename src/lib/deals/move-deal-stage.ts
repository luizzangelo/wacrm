import type { SupabaseClient } from '@supabase/supabase-js';
import type { LossDetails } from './lifecycle';

import type {
  DealStatus,
  MetaConversionEvent,
  MetaConversionEventStatus,
} from '@/types';

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
  lost_reason?: LossDetails['lostReason'] | null;
  lost_reason_notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DealStageTarget {
  id: string;
  pipeline_id: string;
  meta_conversion_event: MetaConversionEvent | null;
  is_lost_stage?: boolean;
}

interface ConversionIntentOutcome {
  conversionEventCreated: boolean;
  conversionEventStatus: MetaConversionEventStatus | null;
  conversionEventName: MetaConversionEvent | null;
}

export type MoveDealToStageResult = ConversionIntentOutcome &
  (
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
      }
  );

export type DealStageMoveErrorCode =
  | 'deal_not_found'
  | 'stage_not_available'
  | 'invalid_current_stage'
  | 'stage_conflict'
  | 'lost_reason_required'
  | 'invalid_loss_notes'
  | 'database_error';

export class DealStageMoveError extends Error {
  constructor(
    readonly code: DealStageMoveErrorCode,
    readonly status: 400 | 404 | 409 | 500,
    readonly currentStageId?: string
  ) {
    super(code);
    this.name = 'DealStageMoveError';
  }
}

export interface MoveDealToStageInput {
  accountId: string;
  actorUserId: string;
  dealId: string;
  newStageId: string;
  lostReason?: LossDetails['lostReason'];
  lostReasonNotes?: string | null;
}

type DealStageRpcResult =
  | ({ ok: true } & MoveDealToStageResult)
  | {
      ok: false;
      error:
        | 'deal_not_found'
        | 'stage_not_available'
        | 'invalid_current_stage'
        | 'stage_conflict'
        | 'lost_reason_required'
        | 'invalid_loss_notes'
        | 'invalid_identifier';
      currentStageId?: string;
    };

export interface DealStageRepository {
  moveWithConversionIntent(
    input: MoveDealToStageInput
  ): Promise<DealStageRpcResult>;
}

function databaseError(operation: string, error: unknown): never {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'unknown';
  console.error('[deal-stage] database operation failed', { operation, code });
  throw new DealStageMoveError('database_error', 500);
}

function isRpcResult(value: unknown): value is DealStageRpcResult {
  if (!value || typeof value !== 'object' || !('ok' in value)) return false;

  const result = value as Record<string, unknown>;
  if (result.ok === false) return typeof result.error === 'string';
  if (result.ok !== true) return false;

  return (
    typeof result.changed === 'boolean' &&
    typeof result.oldStageId === 'string' &&
    typeof result.newStageId === 'string' &&
    result.deal !== null &&
    typeof result.deal === 'object' &&
    result.newStage !== null &&
    typeof result.newStage === 'object'
  );
}

/**
 * Service-role repository for the privileged RPC. Authentication and role
 * authorization happen in the Route Handler before this is constructed;
 * accountId comes from that server-side context, never from request JSON.
 */
export function createDealStageRepository(
  db: SupabaseClient
): DealStageRepository {
  return {
    async moveWithConversionIntent(input) {
      const { data, error } = await db.rpc(
        'move_deal_to_stage_with_conversion_intent',
        {
          p_account_id: input.accountId,
          p_deal_id: input.dealId,
          p_new_stage_id: input.newStageId,
          ...(input.lostReason !== undefined
            ? { p_lost_reason: input.lostReason }
            : {}),
          ...(input.lostReasonNotes !== undefined
            ? { p_lost_reason_notes: input.lostReasonNotes }
            : {}),
        }
      );

      if (error) databaseError('atomic stage transition', error);
      if (!isRpcResult(data))
        databaseError('atomic stage transition result', null);
      return data;
    },
  };
}

/**
 * The only service entry point for transitioning an existing deal. The RPC
 * owns the compare-and-set, attribution freeze, and outbox insert as one
 * database transaction; this layer maps its safe business outcomes to HTTP
 * domain errors without inspecting credentials or calling Meta.
 */
export async function moveDealToStage(
  repository: DealStageRepository,
  input: MoveDealToStageInput
): Promise<MoveDealToStageResult> {
  const result = await repository.moveWithConversionIntent(input);

  if (!result.ok) {
    if (result.error === 'invalid_identifier') {
      databaseError('atomic stage transition identifiers', null);
    }

    const status =
      result.error === 'lost_reason_required' ||
      result.error === 'invalid_loss_notes'
        ? 400
        : result.error === 'deal_not_found' ||
            result.error === 'stage_not_available'
          ? 404
          : 409;

    if (result.error === 'stage_conflict') {
      console.warn('[deal-stage] concurrent stage transition rejected', {
        accountId: input.accountId,
        actorUserId: input.actorUserId,
        dealId: input.dealId,
        requestedStageId: input.newStageId,
        currentStageId: result.currentStageId,
      });
    }

    throw new DealStageMoveError(
      result.error,
      status,
      result.error === 'stage_conflict' ? result.currentStageId : undefined
    );
  }

  const { ok, ...transition } = result;
  void ok;
  return transition;
}
