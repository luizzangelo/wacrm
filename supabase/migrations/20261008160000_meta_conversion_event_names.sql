BEGIN;

ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_meta_conversion_event_check;

ALTER TABLE public.meta_conversion_events
  DROP CONSTRAINT IF EXISTS meta_conversion_events_event_name_check;

UPDATE public.pipeline_stages
SET meta_conversion_event = 'Lead Qualificado'
WHERE meta_conversion_event = 'QualifiedLead';

ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT pipeline_stages_meta_conversion_event_check
  CHECK (
    meta_conversion_event IS NULL
    OR meta_conversion_event IN (
      'LeadSubmitted',
      'Lead Qualificado',
      'Lead Desqualificado',
      'Purchase'
    )
  );

ALTER TABLE public.meta_conversion_events
  ADD CONSTRAINT meta_conversion_events_event_name_check
  CHECK (
    event_name IN (
      'LeadSubmitted',
      'Lead Qualificado',
      'Lead Desqualificado',
      'Purchase',
      'QualifiedLead'
    )
  );

COMMIT;
