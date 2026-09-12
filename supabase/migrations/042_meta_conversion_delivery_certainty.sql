-- Meta's Conversions API for Business Messaging does not deduplicate repeated
-- server events. Represent an in-flight POST explicitly and quarantine every
-- attempt whose delivery outcome cannot be proven.

ALTER TABLE public.meta_conversion_events
  DROP CONSTRAINT IF EXISTS meta_conversion_events_status_check;

ALTER TABLE public.meta_conversion_events
  ADD CONSTRAINT meta_conversion_events_status_check
  CHECK (
    status IN (
      'pending',
      'sending',
      'sent',
      'failed',
      'delivery_unknown',
      'skipped_disabled',
      'skipped_no_attribution',
      'skipped_missing_config'
    )
  );

-- Stage 12 could leave a previously attempted event pending for an automatic
-- retry. Its remote outcome is unknowable, so this is the minimum safe data
-- transition needed before the new worker starts. Existing failed rows are not
-- reclassified.
UPDATE public.meta_conversion_events
SET
  status = 'delivery_unknown',
  error_message = CASE
    WHEN error_message IS NULL OR error_message = ''
      THEN 'delivery_unknown_previous_attempt'
    ELSE 'delivery_unknown_previous_attempt: ' || error_message
  END
WHERE status = 'pending'
  AND attempts > 0;

CREATE INDEX IF NOT EXISTS idx_meta_conversion_events_stale_sending
  ON public.meta_conversion_events(updated_at, id)
  WHERE status = 'sending';
