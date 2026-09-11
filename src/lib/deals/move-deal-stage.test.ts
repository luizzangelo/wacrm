import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
  DealStageMoveError,
  createDealStageRepository,
  moveDealToStage,
  type DealStageRepository,
  type MoveDealToStageInput,
} from './move-deal-stage';

const input: MoveDealToStageInput = {
  accountId: 'account-a',
  actorUserId: 'agent-a',
  dealId: 'deal-a',
  newStageId: 'stage-b',
};

function success(overrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    changed: true as const,
    oldStageId: 'stage-a',
    newStageId: 'stage-b',
    deal: {
      id: 'deal-a',
      user_id: 'user-a',
      pipeline_id: 'pipeline-a',
      stage_id: 'stage-b',
      contact_id: 'contact-a',
      conversation_id: 'conversation-a',
      title: 'Deal A',
      value: 100,
      currency: 'BRL',
      assigned_to: null,
      notes: null,
      expected_close_date: null,
      status: 'open' as const,
      meta_attribution_id: 'attribution-a',
      created_at: '2026-09-11T00:00:00.000Z',
      updated_at: '2026-09-11T00:01:00.000Z',
    },
    newStage: {
      id: 'stage-b',
      pipeline_id: 'pipeline-a',
      meta_conversion_event: 'LeadSubmitted' as const,
    },
    conversionEventCreated: true,
    conversionEventStatus: 'pending' as const,
    conversionEventName: 'LeadSubmitted' as const,
    ...overrides,
  };
}

function repositoryReturning(
  result: Awaited<ReturnType<DealStageRepository['moveWithConversionIntent']>>
): DealStageRepository {
  return {
    moveWithConversionIntent: vi.fn().mockResolvedValue(result),
  };
}

describe('moveDealToStage', () => {
  it('returns the atomic stage/outbox result without exposing credentials', async () => {
    const repository = repositoryReturning(success());

    const result = await moveDealToStage(repository, input);

    expect(result).toMatchObject({
      changed: true,
      oldStageId: 'stage-a',
      newStageId: 'stage-b',
      deal: {
        id: 'deal-a',
        stage_id: 'stage-b',
        meta_attribution_id: 'attribution-a',
      },
      newStage: {
        id: 'stage-b',
        meta_conversion_event: 'LeadSubmitted',
      },
      conversionEventCreated: true,
      conversionEventStatus: 'pending',
      conversionEventName: 'LeadSubmitted',
    });
    expect(result).not.toHaveProperty('access_token');
    expect(result).not.toHaveProperty('marketing_access_token');
  });

  it('preserves same-stage no-op semantics and creates no intent', async () => {
    const repository = repositoryReturning(
      success({
        changed: false,
        reason: 'same_stage',
        oldStageId: 'stage-b',
        conversionEventCreated: false,
        conversionEventStatus: null,
        conversionEventName: null,
      })
    );

    const result = await moveDealToStage(repository, input);

    expect(result).toMatchObject({
      changed: false,
      reason: 'same_stage',
      conversionEventCreated: false,
      conversionEventStatus: null,
      conversionEventName: null,
    });
  });

  it('does not call Meta while creating a mapped-stage intent', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await moveDealToStage(repositoryReturning(success()), input);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['deal_not_found', 404],
    ['stage_not_available', 404],
    ['invalid_current_stage', 409],
  ] as const)(
    'maps RPC outcome %s to a safe domain error',
    async (code, status) => {
      const repository = repositoryReturning({ ok: false, error: code });

      await expect(moveDealToStage(repository, input)).rejects.toMatchObject({
        code,
        status,
      } satisfies Partial<DealStageMoveError>);
    }
  );

  it('preserves the winning stage on a compare-and-set conflict', async () => {
    const repository = repositoryReturning({
      ok: false,
      error: 'stage_conflict',
      currentStageId: 'stage-c',
    });

    await expect(moveDealToStage(repository, input)).rejects.toMatchObject({
      code: 'stage_conflict',
      status: 409,
      currentStageId: 'stage-c',
    } satisfies Partial<DealStageMoveError>);
  });

  it('treats impossible null identifiers from the RPC as a server error', async () => {
    const repository = repositoryReturning({
      ok: false,
      error: 'invalid_identifier',
    });

    await expect(moveDealToStage(repository, input)).rejects.toMatchObject({
      code: 'database_error',
      status: 500,
    } satisfies Partial<DealStageMoveError>);
  });

  it.each([
    ['stage-b', 'stage-b', 2, 0],
    ['stage-b', 'stage-c', 1, 1],
  ] as const)(
    'keeps one CAS winner/event for concurrent targets %s and %s',
    async (firstTarget, secondTarget, fulfilledCount, rejectedCount) => {
      let arrivals = 0;
      let release: (() => void) | undefined;
      const bothRead = new Promise<void>((resolve) => {
        release = resolve;
      });
      let stageId = 'stage-a';
      const events = new Set<string>();

      const repository: DealStageRepository = {
        async moveWithConversionIntent(request) {
          const observedStage = stageId;
          arrivals += 1;
          if (arrivals === 2) release?.();
          await bothRead;

          const eventName =
            request.newStageId === 'stage-b'
              ? ('LeadSubmitted' as const)
              : ('QualifiedLead' as const);

          if (stageId === observedStage) {
            stageId = request.newStageId;
            const eventKey = `${request.dealId}:${eventName}`;
            const created = !events.has(eventKey);
            events.add(eventKey);
            return success({
              newStageId: stageId,
              deal: { ...success().deal, stage_id: stageId },
              newStage: {
                ...success().newStage,
                id: stageId,
                meta_conversion_event: eventName,
              },
              conversionEventCreated: created,
              conversionEventName: eventName,
            });
          }

          if (stageId === request.newStageId) {
            return success({
              changed: false,
              reason: 'same_stage',
              oldStageId: stageId,
              newStageId: stageId,
              deal: { ...success().deal, stage_id: stageId },
              conversionEventCreated: false,
              conversionEventStatus: null,
              conversionEventName: null,
            });
          }

          return {
            ok: false as const,
            error: 'stage_conflict' as const,
            currentStageId: stageId,
          };
        },
      };

      const outcomes = await Promise.allSettled([
        moveDealToStage(repository, { ...input, newStageId: firstTarget }),
        moveDealToStage(repository, { ...input, newStageId: secondTarget }),
      ]);

      expect(
        outcomes.filter((item) => item.status === 'fulfilled')
      ).toHaveLength(fulfilledCount);
      expect(
        outcomes.filter((item) => item.status === 'rejected')
      ).toHaveLength(rejectedCount);
      expect(events.size).toBe(1);
      expect(['stage-b', 'stage-c']).toContain(stageId);

      if (rejectedCount === 1) {
        const rejected = outcomes.find((item) => item.status === 'rejected');
        expect(rejected).toMatchObject({
          reason: {
            code: 'stage_conflict',
            currentStageId: stageId,
          },
        });
      }
    }
  );
});

describe('createDealStageRepository', () => {
  it('invokes only the privileged atomic RPC with server-scoped identifiers', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: success(), error: null });
    const db = { rpc } as unknown as SupabaseClient;
    const repository = createDealStageRepository(db);

    const result = await repository.moveWithConversionIntent(input);

    expect(result).toEqual(success());
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      'move_deal_to_stage_with_conversion_intent',
      {
        p_account_id: 'account-a',
        p_deal_id: 'deal-a',
        p_new_stage_id: 'stage-b',
      }
    );
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('actorUserId');
  });

  it('maps PostgREST failures and malformed results to database_error', async () => {
    const failing = createDealStageRepository({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'not returned to the client' },
      }),
    } as unknown as SupabaseClient);
    const malformed = createDealStageRepository({
      rpc: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }),
    } as unknown as SupabaseClient);

    await expect(failing.moveWithConversionIntent(input)).rejects.toMatchObject(
      {
        code: 'database_error',
        status: 500,
      }
    );
    await expect(
      malformed.moveWithConversionIntent(input)
    ).rejects.toMatchObject({ code: 'database_error', status: 500 });
  });
});
