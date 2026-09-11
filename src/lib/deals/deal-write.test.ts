import { describe, expect, it } from 'vitest';

import {
  buildDealWriteFields,
  buildNewDealInsert,
  hasDealStageChanged,
  moveDealStageIfChanged,
  type DealFormValues,
} from './deal-write';

const values: DealFormValues = {
  title: '  Updated deal  ',
  value: '1250.50',
  currency: 'BRL',
  contactId: 'contact-a',
  stageId: 'stage-b',
  assignedTo: '',
  notes: '  New notes  ',
  expectedCloseDate: '',
};

describe('deal form writes', () => {
  it('omits stage_id and pipeline_id from updates to an existing deal', () => {
    const update = buildDealWriteFields(values);

    expect(update).toEqual({
      title: 'Updated deal',
      value: 1250.5,
      currency: 'BRL',
      contact_id: 'contact-a',
      assigned_to: null,
      notes: 'New notes',
      expected_close_date: null,
    });
    expect(update).not.toHaveProperty('stage_id');
    expect(update).not.toHaveProperty('pipeline_id');
  });

  it('detects only a real change from the original stage', () => {
    expect(hasDealStageChanged('stage-a', 'stage-a')).toBe(false);
    expect(hasDealStageChanged('stage-a', 'stage-b')).toBe(true);
  });

  it('does not call the stage endpoint when only value or notes changed', async () => {
    let moveCalls = 0;

    const moved = await moveDealStageIfChanged(
      'stage-a',
      'stage-a',
      async () => {
        moveCalls += 1;
      }
    );

    expect(moved).toBe(false);
    expect(moveCalls).toBe(0);
  });

  it('delegates a real stage change exactly once', async () => {
    let moveCalls = 0;

    const moved = await moveDealStageIfChanged(
      'stage-a',
      'stage-b',
      async () => {
        moveCalls += 1;
      }
    );

    expect(moved).toBe(true);
    expect(moveCalls).toBe(1);
  });

  it('keeps the initial stage in a new deal insert', () => {
    const insert = buildNewDealInsert(values, {
      userId: 'user-a',
      accountId: 'account-a',
      pipelineId: 'pipeline-a',
    });

    expect(insert).toMatchObject({
      user_id: 'user-a',
      account_id: 'account-a',
      pipeline_id: 'pipeline-a',
      stage_id: 'stage-b',
      status: 'open',
    });
  });
});
