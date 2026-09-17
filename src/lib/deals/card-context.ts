import type { Deal, DealConversationSummary } from '@/types';

export function attachDealConversationSummaries(
  deals: Deal[],
  summaries: DealConversationSummary[]
): Deal[] {
  const byDeal = new Map(
    summaries.map((summary) => [summary.deal_id, summary])
  );
  return deals.map((deal) => ({
    ...deal,
    conversation_summary: byDeal.get(deal.id),
  }));
}

export function leadRegistrationDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' });
}

export function lastMessagePreview(
  summary: DealConversationSummary | undefined,
  noMessages: string,
  attachment: string
): string {
  const text = summary?.last_message_text?.trim();
  if (text) return text.replace(/\s+/g, ' ').slice(0, 240);
  return summary?.last_message_type && summary.last_message_type !== 'text'
    ? attachment
    : noMessages;
}
