export const DIAGNOSTIC_STATUSES = [
  'pending',
  'sending',
  'sent',
  'failed',
  'delivery_unknown',
  'skipped_disabled',
  'skipped_no_attribution',
  'skipped_missing_config',
] as const;
export const DIAGNOSTIC_EVENTS = [
  'LeadSubmitted',
  'QualifiedLead',
  'Purchase',
] as const;
export type DiagnosticStatus = (typeof DIAGNOSTIC_STATUSES)[number];
export type DiagnosticEventName = (typeof DIAGNOSTIC_EVENTS)[number];

export interface EventDiagnostic {
  id: string | null;
  event_name: DiagnosticEventName;
  status: DiagnosticStatus;
  attempts: number;
  event_id_masked: string;
  event_time: string | null;
  created_at: string | null;
  updated_at: string | null;
  sent_at: string | null;
  http_status: number | null;
  meta_error_code: number | null;
  meta_error_subcode: number | null;
  diagnostic_message: string | null;
  deal_id: string | null;
  contact_id: string | null;
  attribution_present: boolean;
  pipeline: string | null;
  stage: string | null;
  purchase: { value: number | null; currency: string | null } | null;
  sending_age_seconds: number | null;
  sending_stale: boolean;
}

export interface EventDiagnosticsPage {
  events: EventDiagnostic[];
  counts: Record<DiagnosticStatus, number>;
  total: number;
  page: number;
  page_size: number;
  dataset_id: string | null;
}
