export interface DealWriteFields {
  title: string;
  value: number;
  currency: string;
  contact_id: string;
  assigned_to: string | null;
  notes: string | null;
  expected_close_date: string | null;
}

export interface DealFormValues {
  title: string;
  value: string;
  currency: string;
  contactId: string;
  stageId: string;
  assignedTo: string;
  notes: string;
  expectedCloseDate: string;
}

export function buildDealWriteFields(values: DealFormValues): DealWriteFields {
  return {
    title: values.title.trim(),
    value: parseFloat(values.value) || 0,
    currency: values.currency,
    contact_id: values.contactId,
    assigned_to: values.assignedTo || null,
    notes: values.notes.trim() || null,
    expected_close_date: values.expectedCloseDate || null,
  };
}

export function buildNewDealInsert(
  values: DealFormValues,
  context: {
    userId: string;
    accountId: string;
    pipelineId: string;
  }
) {
  return {
    ...buildDealWriteFields(values),
    user_id: context.userId,
    account_id: context.accountId,
    pipeline_id: context.pipelineId,
    stage_id: values.stageId,
    status: 'open' as const,
  };
}

export function hasDealStageChanged(
  originalStageId: string,
  selectedStageId: string
): boolean {
  return originalStageId !== selectedStageId;
}

export async function moveDealStageIfChanged(
  originalStageId: string,
  selectedStageId: string,
  move: () => Promise<unknown>
): Promise<boolean> {
  if (!hasDealStageChanged(originalStageId, selectedStageId)) return false;
  await move();
  return true;
}
