import { describe, expect, it } from 'vitest';

import enMessages from '../../../messages/en.json';
import koMessages from '../../../messages/ko.json';
import ptBRMessages from '../../../messages/pt-BR.json';
import type { MetaConversionEvent, PipelineStage } from '@/types';

import {
  META_CONVERSION_SELECT_NONE,
  META_CONVERSION_SELECT_OPTIONS,
  buildNewPipelineStageInsert,
  buildPipelineStageUpsertRows,
  duplicateMetaConversionMessageKey,
  findDuplicateMetaConversionEvent,
  getMetaConversionEventFromError,
  isMetaConversionUniqueViolation,
  metaConversionEventToSelectValue,
  preparePipelineStages,
  selectValueToMetaConversionEvent,
} from './pipeline-stage-mapping';

function stage(
  id: string,
  pipelineId: string,
  event: MetaConversionEvent | null = null,
  overrides: Partial<PipelineStage> = {}
): PipelineStage {
  return {
    id,
    pipeline_id: pipelineId,
    name: `Stage ${id}`,
    position: 0,
    color: '#3b82f6',
    meta_conversion_event: event,
    created_at: '2026-09-11T00:00:00.000Z',
    ...overrides,
  };
}

describe('pipeline stage Meta conversion mapping', () => {
  it('maps the four select choices to their persisted values', () => {
    expect(
      META_CONVERSION_SELECT_OPTIONS.map(({ value, event }) => ({
        value,
        event,
      }))
    ).toEqual([
      { value: META_CONVERSION_SELECT_NONE, event: null },
      { value: 'LeadSubmitted', event: 'LeadSubmitted' },
      { value: 'QualifiedLead', event: 'QualifiedLead' },
      { value: 'Purchase', event: 'Purchase' },
    ]);

    expect(
      selectValueToMetaConversionEvent(META_CONVERSION_SELECT_NONE)
    ).toBeNull();
    expect(selectValueToMetaConversionEvent('LeadSubmitted')).toBe(
      'LeadSubmitted'
    );
    expect(selectValueToMetaConversionEvent('QualifiedLead')).toBe(
      'QualifiedLead'
    );
    expect(selectValueToMetaConversionEvent('Purchase')).toBe('Purchase');
  });

  it('shows localized, non-technical labels for every choice', () => {
    const labelKeys = META_CONVERSION_SELECT_OPTIONS.map(
      (option) => option.labelKey
    );

    expect(
      labelKeys.map((key) => ptBRMessages.Pipelines.settings[key])
    ).toEqual(['Não enviar evento', 'Lead', 'Lead qualificado', 'Compra']);
    expect(labelKeys.every((key) => enMessages.Pipelines.settings[key])).toBe(
      true
    );
    expect(labelKeys.every((key) => koMessages.Pipelines.settings[key])).toBe(
      true
    );
  });

  it('loads existing mappings and treats an omitted value as none', () => {
    const loaded = preparePipelineStages([
      stage('purchase', 'pipeline-a', 'Purchase', { position: 3 }),
      stage('none', 'pipeline-a', null, { position: 0 }),
      stage('lead', 'pipeline-a', 'LeadSubmitted', { position: 1 }),
      stage('qualified', 'pipeline-a', 'QualifiedLead', { position: 2 }),
      { ...stage('legacy', 'pipeline-a'), meta_conversion_event: undefined },
    ]);

    expect(loaded.map((item) => item.id)).toEqual([
      'none',
      'legacy',
      'lead',
      'qualified',
      'purchase',
    ]);
    expect(
      loaded.find((item) => item.id === 'legacy')?.meta_conversion_event
    ).toBeNull();
    expect(metaConversionEventToSelectValue(null)).toBe(
      META_CONVERSION_SELECT_NONE
    );
    expect(metaConversionEventToSelectValue('LeadSubmitted')).toBe(
      'LeadSubmitted'
    );
    expect(metaConversionEventToSelectValue('QualifiedLead')).toBe(
      'QualifiedLead'
    );
    expect(metaConversionEventToSelectValue('Purchase')).toBe('Purchase');
  });

  it('creates every new stage with an explicit null mapping', () => {
    expect(
      buildNewPipelineStageInsert('pipeline-a', 'New stage', '#22c55e', 4)
    ).toEqual({
      pipeline_id: 'pipeline-a',
      name: 'New stage',
      color: '#22c55e',
      position: 4,
      meta_conversion_event: null,
    });
  });

  it.each([
    ['LeadSubmitted', 'metaConversionDuplicateLead'],
    ['QualifiedLead', 'metaConversionDuplicateQualifiedLead'],
    ['Purchase', 'metaConversionDuplicatePurchase'],
  ] as const)('blocks duplicate %s mappings in one pipeline', (event, key) => {
    expect(
      findDuplicateMetaConversionEvent([
        preparePipelineStages([stage('a', 'pipeline-a', event)])[0],
        preparePipelineStages([stage('b', 'pipeline-a', event)])[0],
      ])
    ).toBe(event);
    expect(duplicateMetaConversionMessageKey(event)).toBe(key);
  });

  it('allows the same event in different pipelines', () => {
    expect(
      findDuplicateMetaConversionEvent([
        preparePipelineStages([stage('a', 'pipeline-a', 'LeadSubmitted')])[0],
        preparePipelineStages([stage('b', 'pipeline-b', 'LeadSubmitted')])[0],
      ])
    ).toBeNull();
  });

  it('persists mappings and keeps them attached to stage IDs after reorder, rename, and color changes', () => {
    const original = preparePipelineStages([
      stage('lead', 'pipeline-a', 'LeadSubmitted', { position: 0 }),
      stage('qualified', 'pipeline-a', 'QualifiedLead', { position: 1 }),
    ]);
    const changed = [
      {
        ...original[1],
        name: 'Renamed qualified',
        color: '#f97316',
      },
      original[0],
    ];

    expect(buildPipelineStageUpsertRows(changed)).toEqual([
      {
        id: 'qualified',
        pipeline_id: 'pipeline-a',
        name: 'Renamed qualified',
        color: '#f97316',
        position: 0,
        meta_conversion_event: 'QualifiedLead',
      },
      {
        id: 'lead',
        pipeline_id: 'pipeline-a',
        name: 'Stage lead',
        color: '#3b82f6',
        position: 1,
        meta_conversion_event: 'LeadSubmitted',
      },
    ]);
  });

  it('persists resetting a mapping to none as null', () => {
    const [mapped] = preparePipelineStages([
      stage('lead', 'pipeline-a', 'LeadSubmitted'),
    ]);

    expect(
      buildPipelineStageUpsertRows([
        { ...mapped, meta_conversion_event: null },
      ])[0].meta_conversion_event
    ).toBeNull();
  });

  it('releases an existing mapping before assigning it to another stage in the same batch', () => {
    const stages = preparePipelineStages([
      stage('new-owner', 'pipeline-a', 'LeadSubmitted', { position: 0 }),
      stage('old-owner', 'pipeline-a', null, { position: 1 }),
    ]);

    expect(
      buildPipelineStageUpsertRows(stages).map((row) => ({
        id: row.id,
        position: row.position,
        event: row.meta_conversion_event,
      }))
    ).toEqual([
      { id: 'old-owner', position: 1, event: null },
      { id: 'new-owner', position: 0, event: 'LeadSubmitted' },
    ]);
  });

  it('recognizes and sanitizes Postgres unique violations', () => {
    const error = {
      code: '23505',
      message:
        'duplicate key value violates unique constraint idx_pipeline_stages_pipeline_meta_conversion_event',
      details:
        'Key (pipeline_id, meta_conversion_event)=(pipeline-a, QualifiedLead) already exists.',
    };

    expect(isMetaConversionUniqueViolation(error)).toBe(true);
    expect(getMetaConversionEventFromError(error)).toBe('QualifiedLead');
    expect(isMetaConversionUniqueViolation({ code: '42501' })).toBe(false);
    expect(
      isMetaConversionUniqueViolation({
        code: '23505',
        message: 'duplicate key value violates unique constraint other_index',
      })
    ).toBe(false);
    expect(getMetaConversionEventFromError({ code: '42501' })).toBeNull();
  });
});
