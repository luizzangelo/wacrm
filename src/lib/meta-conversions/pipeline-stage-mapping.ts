import type { MetaConversionEvent, PipelineStage } from '@/types';

export const META_CONVERSION_SELECT_NONE = '__none__' as const;

export const META_CONVERSION_SELECT_OPTIONS = [
  {
    value: META_CONVERSION_SELECT_NONE,
    event: null,
    labelKey: 'metaConversionNone',
  },
  {
    value: 'LeadSubmitted',
    event: 'LeadSubmitted',
    labelKey: 'metaConversionLead',
  },
  {
    value: 'QualifiedLead',
    event: 'QualifiedLead',
    labelKey: 'metaConversionQualifiedLead',
  },
  {
    value: 'Purchase',
    event: 'Purchase',
    labelKey: 'metaConversionPurchase',
  },
] as const satisfies ReadonlyArray<{
  value: typeof META_CONVERSION_SELECT_NONE | MetaConversionEvent;
  event: MetaConversionEvent | null;
  labelKey:
    | 'metaConversionNone'
    | 'metaConversionLead'
    | 'metaConversionQualifiedLead'
    | 'metaConversionPurchase';
}>;

export type EditablePipelineStage = PipelineStage & {
  meta_conversion_event: MetaConversionEvent | null;
};

export type PipelineStageUpsertRow = Pick<
  EditablePipelineStage,
  'id' | 'pipeline_id' | 'name' | 'color' | 'position' | 'meta_conversion_event'
>;

export function preparePipelineStages(
  stages: PipelineStage[]
): EditablePipelineStage[] {
  return [...stages]
    .sort((a, b) => a.position - b.position)
    .map((stage) => ({
      ...stage,
      meta_conversion_event: stage.meta_conversion_event ?? null,
    }));
}

export function buildNewPipelineStageInsert(
  pipelineId: string,
  name: string,
  color: string,
  position: number
) {
  return {
    pipeline_id: pipelineId,
    name,
    color,
    position,
    meta_conversion_event: null,
  };
}

export function buildPipelineStageUpsertRows(
  stages: EditablePipelineStage[]
): PipelineStageUpsertRow[] {
  const rows = stages.map((stage, position) => ({
    id: stage.id,
    pipeline_id: stage.pipeline_id,
    name: stage.name,
    color: stage.color,
    position,
    meta_conversion_event: stage.meta_conversion_event,
  }));

  // Release mappings first so a valid reassignment is not rejected only
  // because its new owner appears earlier in the visual stage order.
  return rows.sort(
    (a, b) =>
      Number(a.meta_conversion_event !== null) -
      Number(b.meta_conversion_event !== null)
  );
}

export function selectValueToMetaConversionEvent(
  value: string
): MetaConversionEvent | null {
  return (
    META_CONVERSION_SELECT_OPTIONS.find((option) => option.value === value)
      ?.event ?? null
  );
}

export function metaConversionEventToSelectValue(
  event: MetaConversionEvent | null | undefined
): typeof META_CONVERSION_SELECT_NONE | MetaConversionEvent {
  return event ?? META_CONVERSION_SELECT_NONE;
}

export function findDuplicateMetaConversionEvent(
  stages: Array<
    Pick<EditablePipelineStage, 'pipeline_id' | 'meta_conversion_event'>
  >
): MetaConversionEvent | null {
  const seen = new Set<string>();

  for (const stage of stages) {
    if (!stage.meta_conversion_event) continue;

    const key = `${stage.pipeline_id}:${stage.meta_conversion_event}`;
    if (seen.has(key)) return stage.meta_conversion_event;
    seen.add(key);
  }

  return null;
}

export function duplicateMetaConversionMessageKey(
  event: MetaConversionEvent
):
  | 'metaConversionDuplicateLead'
  | 'metaConversionDuplicateQualifiedLead'
  | 'metaConversionDuplicatePurchase' {
  switch (event) {
    case 'LeadSubmitted':
      return 'metaConversionDuplicateLead';
    case 'QualifiedLead':
      return 'metaConversionDuplicateQualifiedLead';
    case 'Purchase':
      return 'metaConversionDuplicatePurchase';
  }
}

function getDatabaseErrorText(error: object): string {
  return ['constraint', 'message', 'details', 'hint']
    .flatMap((field) => {
      if (!(field in error)) return [];
      const value = (error as Record<string, unknown>)[field];
      return typeof value === 'string' ? [value] : [];
    })
    .join(' ');
}

export function isMetaConversionUniqueViolation(error: unknown): boolean {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('code' in error) ||
    error.code !== '23505'
  ) {
    return false;
  }

  const errorText = getDatabaseErrorText(error);
  return (
    errorText.includes('idx_pipeline_stages_pipeline_meta_conversion_event') ||
    errorText.includes('meta_conversion_event')
  );
}

export function getMetaConversionEventFromError(
  error: unknown
): MetaConversionEvent | null {
  if (!isMetaConversionUniqueViolation(error)) return null;

  const details = getDatabaseErrorText(error as object);
  return (
    META_CONVERSION_SELECT_OPTIONS.find(
      (option) => option.event && details.includes(option.event)
    )?.event ?? null
  );
}
