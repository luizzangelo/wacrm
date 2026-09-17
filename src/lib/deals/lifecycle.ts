import type { Deal, PipelineStage } from '@/types';

export const LOST_REASONS = [
  'price',
  'no_interest',
  'no_budget',
  'no_response',
  'competitor',
  'unavailable',
  'bad_timing',
  'unqualified',
  'other',
] as const;
export type LostReason = (typeof LOST_REASONS)[number];
export interface LossDetails {
  lostReason: LostReason;
  lostReasonNotes?: string | null;
}

export function isLostReason(value: unknown): value is LostReason {
  return (
    typeof value === 'string' && LOST_REASONS.some((code) => code === value)
  );
}

export function sortDealStages(stages: PipelineStage[]): PipelineStage[] {
  return [...stages].sort(
    (a, b) =>
      Number(Boolean(a.is_lost_stage)) - Number(Boolean(b.is_lost_stage)) ||
      a.position - b.position ||
      a.id.localeCompare(b.id)
  );
}

export function initialDealStage(
  stages: PipelineStage[]
): PipelineStage | undefined {
  return sortDealStages(stages).find((stage) => !stage.is_lost_stage);
}

/** Never fall back to a stale, independently editable deals.title. */
export function dealContactName(
  deal: Pick<Deal, 'contact'>,
  noContact: string
): string {
  return deal.contact?.name?.trim() || noContact;
}

/** Shared by drag/drop and form actions: defer all writes until confirmation. */
export function needsLossConfirmation(stage: PipelineStage): boolean {
  return stage.is_lost_stage === true;
}
