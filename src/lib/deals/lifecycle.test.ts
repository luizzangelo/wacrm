import { describe, expect, it } from 'vitest';
import type { PipelineStage } from '@/types';
import en from '../../../messages/en.json';
import pt from '../../../messages/pt-BR.json';
import ko from '../../../messages/ko.json';
import {
  LOST_REASONS,
  dealContactName,
  initialDealStage,
  isLostReason,
  needsLossConfirmation,
} from './lifecycle';
function stage(id: string, position: number, lost = false): PipelineStage {
  return {
    id,
    position,
    is_lost_stage: lost,
    pipeline_id: 'pipeline',
    name: 'Any translated name',
    color: 'red',
    created_at: 'date',
  };
}
describe('shared deal lifecycle contracts', () => {
  it('does not use text to infer loss', () => {
    expect(
      needsLossConfirmation({ ...stage('normal', 0), name: 'Venda perdida' })
    ).toBe(false);
    expect(needsLossConfirmation(stage('lost', 0, true))).toBe(true);
  });
  it('orders ties deterministically and never selects loss', () => {
    expect(
      initialDealStage([stage('lost', -99, true), stage('b', 0), stage('a', 0)])
        ?.id
    ).toBe('a');
    expect(initialDealStage([stage('lost', 0, true)])).toBeUndefined();
  });
  it('does not display stale title or telephone if contact was removed', () => {
    expect(dealContactName({ contact: undefined }, 'No contact')).toBe(
      'No contact'
    );
  });
  it.each([en, pt, ko])(
    'translates every loss code and lifecycle message',
    (messages) => {
      for (const code of LOST_REASONS)
        expect(messages.Pipelines.loss.reasons[code]).toBeTruthy();
      for (const value of Object.values(messages.Pipelines.loss))
        expect(value).toBeTruthy();
      expect(messages.Pipelines.form.toastRequired).not.toMatch(
        /Title|Título|제목/
      );
    }
  );
  it.each(LOST_REASONS)('accepts stable code %s', (code) => {
    expect(isLostReason(code)).toBe(true);
  });
  it.each(['Preço', 'unknown', null, 42, ''])(
    'rejects label or invalid code %s',
    (code) => {
      expect(isLostReason(code)).toBe(false);
    }
  );
});
