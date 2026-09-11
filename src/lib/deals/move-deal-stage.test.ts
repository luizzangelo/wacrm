import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DealStageMoveError,
  createDealStageRepository,
  moveDealToStage,
  type DealStageRepository,
  type DealStageSnapshot,
  type DealStageTarget,
} from './move-deal-stage';

interface MemoryDeal extends DealStageSnapshot {
  account_id: string;
}

function deal(overrides: Partial<MemoryDeal> = {}): MemoryDeal {
  return {
    id: 'deal-a',
    user_id: 'user-a',
    account_id: 'account-a',
    pipeline_id: 'pipeline-a',
    stage_id: 'stage-a',
    contact_id: 'contact-a',
    conversation_id: 'conversation-a',
    title: 'Deal A',
    value: 100,
    currency: 'BRL',
    assigned_to: null,
    notes: null,
    expected_close_date: null,
    status: 'open',
    meta_attribution_id: 'attribution-a',
    created_at: '2026-09-11T00:00:00.000Z',
    updated_at: '2026-09-11T00:00:00.000Z',
    ...overrides,
  };
}

class MemoryRepository implements DealStageRepository {
  deals = new Map<string, MemoryDeal>();
  pipelines = new Map<string, string>();
  stages = new Map<string, DealStageTarget>();
  compareAndSetCalls = 0;

  constructor() {
    this.deals.set('deal-a', deal());
    this.pipelines.set('pipeline-a', 'account-a');
    this.pipelines.set('pipeline-b', 'account-a');
    this.pipelines.set('pipeline-foreign', 'account-b');
    this.stages.set('stage-a', {
      id: 'stage-a',
      pipeline_id: 'pipeline-a',
      meta_conversion_event: null,
    });
    this.stages.set('stage-b', {
      id: 'stage-b',
      pipeline_id: 'pipeline-a',
      meta_conversion_event: 'LeadSubmitted',
    });
    this.stages.set('stage-c', {
      id: 'stage-c',
      pipeline_id: 'pipeline-a',
      meta_conversion_event: 'QualifiedLead',
    });
    this.stages.set('other-pipeline-stage', {
      id: 'other-pipeline-stage',
      pipeline_id: 'pipeline-b',
      meta_conversion_event: null,
    });
    this.stages.set('foreign-stage', {
      id: 'foreign-stage',
      pipeline_id: 'pipeline-foreign',
      meta_conversion_event: null,
    });
  }

  async findDeal(accountId: string, dealId: string) {
    const found = this.deals.get(dealId);
    if (!found || found.account_id !== accountId) return null;
    const { account_id: scopedAccountId, ...snapshot } = found;
    void scopedAccountId;
    return { ...snapshot };
  }

  async pipelineBelongsToAccount(accountId: string, pipelineId: string) {
    return this.pipelines.get(pipelineId) === accountId;
  }

  async findStages(pipelineId: string, stageIds: string[]) {
    return stageIds.flatMap((stageId) => {
      const found = this.stages.get(stageId);
      return found?.pipeline_id === pipelineId ? [{ ...found }] : [];
    });
  }

  async compareAndSetStage(input: {
    accountId: string;
    dealId: string;
    oldStageId: string;
    newStageId: string;
  }) {
    this.compareAndSetCalls += 1;
    const current = this.deals.get(input.dealId);
    if (
      !current ||
      current.account_id !== input.accountId ||
      current.stage_id !== input.oldStageId
    ) {
      return null;
    }
    current.stage_id = input.newStageId;
    current.updated_at = '2026-09-11T00:01:00.000Z';
    return this.findDeal(input.accountId, input.dealId);
  }
}

const input = {
  accountId: 'account-a',
  actorUserId: 'agent-a',
  dealId: 'deal-a',
  newStageId: 'stage-b',
};

let repository: MemoryRepository;

beforeEach(() => {
  repository = new MemoryRepository();
});

describe('moveDealToStage', () => {
  it('moves a deal to a stage in its pipeline and returns the transition', async () => {
    const result = await moveDealToStage(repository, input);

    expect(result).toMatchObject({
      changed: true,
      oldStageId: 'stage-a',
      newStageId: 'stage-b',
      deal: { id: 'deal-a', stage_id: 'stage-b' },
      newStage: {
        id: 'stage-b',
        meta_conversion_event: 'LeadSubmitted',
      },
    });
    expect(repository.deals.get('deal-a')?.stage_id).toBe('stage-b');
  });

  it('returns a no-op for the current stage without updating updated_at', async () => {
    const before = repository.deals.get('deal-a')?.updated_at;

    const result = await moveDealToStage(repository, {
      ...input,
      newStageId: 'stage-a',
    });

    expect(result).toMatchObject({
      changed: false,
      reason: 'same_stage',
      oldStageId: 'stage-a',
      newStageId: 'stage-a',
    });
    expect(repository.compareAndSetCalls).toBe(0);
    expect(repository.deals.get('deal-a')?.updated_at).toBe(before);
  });

  it.each(['other-pipeline-stage', 'foreign-stage'])(
    'rejects unavailable target stage %s without changing the deal',
    async (newStageId) => {
      await expect(
        moveDealToStage(repository, { ...input, newStageId })
      ).rejects.toMatchObject({
        code: 'stage_not_available',
        status: 404,
      } satisfies Partial<DealStageMoveError>);
      expect(repository.deals.get('deal-a')?.stage_id).toBe('stage-a');
      expect(repository.compareAndSetCalls).toBe(0);
    }
  );

  it('does not expose or move a deal from another account', async () => {
    await expect(
      moveDealToStage(repository, { ...input, accountId: 'account-b' })
    ).rejects.toMatchObject({
      code: 'deal_not_found',
      status: 404,
    } satisfies Partial<DealStageMoveError>);
    expect(repository.compareAndSetCalls).toBe(0);
  });

  it('rejects an inconsistent current stage instead of repairing it', async () => {
    const current = repository.deals.get('deal-a');
    if (!current) throw new Error('fixture missing');
    current.stage_id = 'other-pipeline-stage';

    await expect(moveDealToStage(repository, input)).rejects.toMatchObject({
      code: 'invalid_current_stage',
      status: 409,
    } satisfies Partial<DealStageMoveError>);
    expect(repository.compareAndSetCalls).toBe(0);
  });

  it('allows only one of two concurrent moves based on the same old stage', async () => {
    const [first, second] = await Promise.allSettled([
      moveDealToStage(repository, input),
      moveDealToStage(repository, { ...input, newStageId: 'stage-c' }),
    ]);
    const results = [first, second];
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.find((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    if (!rejected || rejected.status !== 'rejected') {
      throw new Error('expected one rejected concurrent move');
    }
    expect(rejected.reason).toMatchObject({
      code: 'stage_conflict',
      status: 409,
      currentStageId: repository.deals.get('deal-a')?.stage_id,
    });
    expect(repository.compareAndSetCalls).toBe(2);
  });

  it('does not call Meta or change attribution when entering a mapped stage', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await moveDealToStage(repository, input);

    expect(result.newStage.meta_conversion_event).toBe('LeadSubmitted');
    expect(result.deal.meta_attribution_id).toBe('attribution-a');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('createDealStageRepository compare-and-set', () => {
  it('conditions the stage update on account, deal, and old stage', async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const row = { ...deal(), stage_id: 'stage-b' };
    const builder = {
      update(value: unknown) {
        calls.push({ method: 'update', args: [value] });
        return builder;
      },
      eq(column: string, value: unknown) {
        calls.push({ method: 'eq', args: [column, value] });
        return builder;
      },
      select(value: string) {
        calls.push({ method: 'select', args: [value] });
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({ data: row, error: null });
      },
    };
    const db = {
      from(table: string) {
        calls.push({ method: 'from', args: [table] });
        return builder;
      },
    } as unknown as SupabaseClient;
    const store = createDealStageRepository(db);

    const result = await store.compareAndSetStage({
      accountId: 'account-a',
      dealId: 'deal-a',
      oldStageId: 'stage-a',
      newStageId: 'stage-b',
    });

    expect(result?.stage_id).toBe('stage-b');
    expect(calls).toContainEqual({
      method: 'update',
      args: [{ stage_id: 'stage-b' }],
    });
    expect(calls).toContainEqual({
      method: 'eq',
      args: ['id', 'deal-a'],
    });
    expect(calls).toContainEqual({
      method: 'eq',
      args: ['account_id', 'account-a'],
    });
    expect(calls).toContainEqual({
      method: 'eq',
      args: ['stage_id', 'stage-a'],
    });
  });
});
