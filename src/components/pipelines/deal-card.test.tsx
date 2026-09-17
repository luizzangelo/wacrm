// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@/types';
import messages from '../../../messages/pt-BR.json';
import { DealCard } from './deal-card';
import { formatCurrency } from '@/lib/currency';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) =>
    messages.Pipelines.card[key as keyof typeof messages.Pipelines.card],
}));
const deal = {
  id: 'deal',
  title: 'Legacy title',
  value: 85.98,
  currency: 'BRL',
  contact: { name: 'Contact fixture' },
  conversation_summary: {
    deal_id: 'deal',
    conversation_id: 'conversation',
    last_message_text: 'Latest conversation message',
    last_message_type: 'text',
    first_inbound_at: '2026-09-17T10:30:00Z',
  },
} as Deal;
afterEach(cleanup);
function card(value = deal, overlay = false) {
  const edit = vi.fn();
  render(
    <DealCard deal={value} stage={null} onEdit={edit} isOverlay={overlay} />
  );
  return edit;
}
describe('Kanban card: latest message and lead registration', () => {
  it('shows contact name exactly once and never legacy title', () => {
    card();
    expect(screen.getAllByText('Contact fixture')).toHaveLength(1);
    expect(screen.queryByText('Legacy title')).toBeNull();
  });
  it('shows latest conversation message on secondary line', () => {
    card();
    expect(screen.getByText('Latest conversation message').tagName).toBe('P');
  });
  it('shows first inbound date in pt-BR at top right, not deal creation date', () => {
    card({ ...deal, created_at: '2026-08-01T10:00:00Z' });
    const date = screen.getByText('17/09/2026');
    expect(date.tagName).toBe('TIME');
    expect(date.getAttribute('datetime')).toBe(
      deal.conversation_summary!.first_inbound_at
    );
    expect(date.closest('div')?.querySelector('h4')).toBeTruthy();
    expect(screen.queryByText('01/08/2026')).toBeNull();
  });
  it('missing conversation has safe message and date fallback', () => {
    card({ ...deal, conversation_summary: undefined });
    expect(screen.getByText('Sem mensagens')).toBeTruthy();
    expect(screen.getByText('Sem data')).toBeTruthy();
  });
  it('conversation without messages has safe fallback', () => {
    card({
      ...deal,
      conversation_summary: {
        ...deal.conversation_summary!,
        last_message_text: null,
        last_message_type: null,
        first_inbound_at: null,
      },
    });
    expect(screen.getByText('Sem mensagens')).toBeTruthy();
    expect(screen.getByText('Sem data')).toBeTruthy();
  });
  it('media without caption uses translated attachment fallback', () => {
    card({
      ...deal,
      conversation_summary: {
        ...deal.conversation_summary!,
        last_message_text: null,
        last_message_type: 'image',
      },
    });
    expect(screen.getByText('Mensagem com anexo')).toBeTruthy();
  });
  it('deal value remains visible', () => {
    card();
    expect(
      screen.getByText(formatCurrency(deal.value, deal.currency))
    ).toBeTruthy();
  });
  it('does not render message markup as HTML', () => {
    card({
      ...deal,
      conversation_summary: {
        ...deal.conversation_summary!,
        last_message_text: '<script>privateMarkup</script>',
      },
    });
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText('<script>privateMarkup</script>')).toBeTruthy();
  });
  it('existing edit click remains functional', () => {
    const edit = card();
    fireEvent.click(screen.getByRole('button'));
    expect(edit).toHaveBeenCalledWith(deal);
  });
  it('drag overlay cannot open edit', () => {
    const edit = card(deal, true);
    fireEvent.click(screen.getByRole('button'));
    expect(edit).not.toHaveBeenCalled();
  });
  it('existing expected close date remains accurate without timezone day shift', () => {
    card({ ...deal, expected_close_date: '2026-09-20' });
    expect(screen.getByText('20/09/2026')).toBeTruthy();
  });
  it('invalid registration timestamp shows safe fallback', () => {
    card({
      ...deal,
      conversation_summary: {
        ...deal.conversation_summary!,
        first_inbound_at: 'not-a-date',
      },
    });
    expect(screen.getByText('Sem data')).toBeTruthy();
  });
  it('registration remains rightmost even when a status badge is shown', () => {
    card({ ...deal, status: 'won' });
    const date = screen.getByText('17/09/2026');
    expect(date.parentElement?.parentElement?.lastElementChild).toBe(
      date.parentElement
    );
    expect(screen.getByText('Ganho')).toBeTruthy();
  });
});
