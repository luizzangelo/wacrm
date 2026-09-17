import { describe, expect, it } from 'vitest';
import type { Deal, DealConversationSummary } from '@/types';
import {
  attachDealConversationSummaries,
  lastMessagePreview,
  leadRegistrationDate,
} from './card-context';
describe('card context helpers', () => {
  it('joins batched summaries by deal id without changing original deals', () => {
    const deals = [{ id: 'one' }, { id: 'two' }] as Deal[];
    const summary = {
      deal_id: 'two',
      last_message_text: 'Latest',
    } as DealConversationSummary;
    const result = attachDealConversationSummaries(deals, [summary]);
    expect(result[0].conversation_summary).toBeUndefined();
    expect(result[1].conversation_summary).toBe(summary);
    expect(deals[1].conversation_summary).toBeUndefined();
  });
  it('ignores summaries of unrelated deal ids', () => {
    expect(
      attachDealConversationSummaries(
        [{ id: 'one' }] as Deal[],
        [{ deal_id: 'other' }] as DealConversationSummary[]
      )[0].conversation_summary
    ).toBeUndefined();
  });
  it('formats pt-BR in the lead timezone', () => {
    expect(leadRegistrationDate('2026-09-17T01:00:00Z')).toBe('16/09/2026');
  });
  it.each([null, undefined, '', 'invalid'])(
    'missing/invalid %s date is safe',
    (value) => {
      expect(leadRegistrationDate(value)).toBeNull();
    }
  );
  it('collapses whitespace and caps preview', () => {
    expect(
      lastMessagePreview(
        {
          last_message_text: ' A\n B ' + 'x'.repeat(300),
        } as DealConversationSummary,
        'None',
        'Attachment'
      )
    ).toHaveLength(240);
  });
  it('blank text does not become an empty line', () => {
    expect(
      lastMessagePreview(
        {
          last_message_text: '  ',
          last_message_type: 'text',
        } as DealConversationSummary,
        'None',
        'Attachment'
      )
    ).toBe('None');
  });
});
