import type { SupabaseClient } from '@supabase/supabase-js';

import type { MetaConversionEvent, MetaConversionEventStatus } from '@/types';
import { decrypt } from '@/lib/whatsapp/encryption';

import {
  META_CONVERSION_EVENT_BATCH_SIZE,
  META_CONVERSION_EVENT_CLAIM_LEASE_MS,
} from './constants';
import {
  sanitizeMetaConversionText,
  sendMetaConversionEvent,
  type MetaConversionDeliveryResult,
  type MetaConversionsRequest,
  type SanitizedMetaConversionsResponse,
} from './conversions-api';

export interface StoredMetaConversionEvent {
  id: string;
  account_id: string;
  attribution_id: string | null;
  event_name: MetaConversionEvent;
  event_id: string;
  event_time: string;
  value: number | string | null;
  currency: string | null;
  status: MetaConversionEventStatus;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export interface StoredMetaConversionDeliveryConfig {
  account_id: string;
  dataset_id: string | null;
  access_token: string | null;
  enabled: boolean;
}

export interface StoredMetaConversionAttribution {
  id: string;
  account_id: string;
  ctwa_clid: string;
  waba_id: string | null;
}

export interface MetaConversionCandidate {
  id: string;
  account_id: string;
}

interface DeliveryPersistence {
  status: 'sent' | 'failed' | 'delivery_unknown';
  sent_at: string | null;
  meta_http_status: number | null;
  meta_response: SanitizedMetaConversionsResponse | null;
  error_message: string | null;
}

export interface MetaConversionEventRepository {
  getEvent(
    accountId: string,
    eventId: string
  ): Promise<StoredMetaConversionEvent | null>;
  getConfig(
    accountId: string
  ): Promise<StoredMetaConversionDeliveryConfig | null>;
  getAttribution(
    accountId: string,
    attributionId: string
  ): Promise<StoredMetaConversionAttribution | null>;
  markBeforeAttempt(
    accountId: string,
    eventId: string,
    expectedAttempts: number,
    status: Extract<
      MetaConversionEventStatus,
      | 'failed'
      | 'delivery_unknown'
      | 'skipped_disabled'
      | 'skipped_missing_config'
      | 'skipped_no_attribution'
    >,
    errorMessage: string
  ): Promise<boolean>;
  claimAttempt(
    accountId: string,
    eventId: string,
    expectedAttempts: number
  ): Promise<boolean>;
  persistAttemptResult(
    accountId: string,
    eventId: string,
    attempt: number,
    result: DeliveryPersistence
  ): Promise<boolean>;
  recoverStaleSending(staleBefore: string): Promise<number>;
  listPending(limit: number): Promise<MetaConversionCandidate[]>;
}

export type MetaConversionProcessingResult =
  | { status: 'sent'; attempt: number }
  | { status: 'failed'; attempt: number | null }
  | { status: 'delivery_unknown'; attempt: number | null }
  | {
      status:
        | 'skipped_disabled'
        | 'skipped_missing_config'
        | 'skipped_no_attribution';
    }
  | { status: 'busy' }
  | { status: 'ignored' }
  | { status: 'not_found' };

export interface MetaConversionBatchResult {
  recovered_sending: number;
  scanned: number;
  sent: number;
  failed: number;
  delivery_unknown: number;
  skipped_disabled: number;
  skipped_missing_config: number;
  skipped_no_attribution: number;
  busy: number;
  ignored: number;
  not_found: number;
  errors: number;
}

class MetaConversionPersistenceError extends Error {
  constructor(
    readonly operation: string,
    readonly code: string
  ) {
    super('Meta conversion event persistence failed');
    this.name = 'MetaConversionPersistenceError';
  }
}

function databaseErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code).slice(0, 64)
    : 'unknown';
}

function assertDatabaseResult(operation: string, error: unknown): void {
  if (error) {
    throw new MetaConversionPersistenceError(
      operation,
      databaseErrorCode(error)
    );
  }
}

const EVENT_SELECT =
  'id,account_id,attribution_id,event_name,event_id,event_time,value,currency,status,attempts,created_at,updated_at';

export function createMetaConversionEventRepository(
  db: SupabaseClient
): MetaConversionEventRepository {
  return {
    async getEvent(accountId, eventId) {
      const { data, error } = await db
        .from('meta_conversion_events')
        .select(EVENT_SELECT)
        .eq('id', eventId)
        .eq('account_id', accountId)
        .maybeSingle();
      assertDatabaseResult('get_event', error);
      return data as StoredMetaConversionEvent | null;
    },

    async getConfig(accountId) {
      const { data, error } = await db
        .from('meta_conversion_config')
        .select('account_id,dataset_id,access_token,enabled')
        .eq('account_id', accountId)
        .maybeSingle();
      assertDatabaseResult('get_config', error);
      return data as StoredMetaConversionDeliveryConfig | null;
    },

    async getAttribution(accountId, attributionId) {
      const { data, error } = await db
        .from('meta_ad_attributions')
        .select('id,account_id,ctwa_clid,waba_id')
        .eq('id', attributionId)
        .eq('account_id', accountId)
        .maybeSingle();
      assertDatabaseResult('get_attribution', error);
      return data as StoredMetaConversionAttribution | null;
    },

    async markBeforeAttempt(
      accountId,
      eventId,
      expectedAttempts,
      status,
      errorMessage
    ) {
      const { data, error } = await db
        .from('meta_conversion_events')
        .update(
          status === 'delivery_unknown'
            ? { status, error_message: errorMessage }
            : {
                status,
                meta_http_status: null,
                meta_response: null,
                error_message: errorMessage,
                sent_at: null,
              }
        )
        .eq('id', eventId)
        .eq('account_id', accountId)
        .eq('status', 'pending')
        .eq('attempts', expectedAttempts)
        .select('id')
        .maybeSingle();
      assertDatabaseResult('mark_before_attempt', error);
      return data !== null;
    },

    async claimAttempt(accountId, eventId, expectedAttempts) {
      const { data, error } = await db
        .from('meta_conversion_events')
        .update({
          status: 'sending',
          attempts: expectedAttempts + 1,
          error_message: null,
        })
        .eq('id', eventId)
        .eq('account_id', accountId)
        .eq('status', 'pending')
        .eq('attempts', expectedAttempts)
        .select('id')
        .maybeSingle();
      assertDatabaseResult('claim_attempt', error);
      return data !== null;
    },

    async persistAttemptResult(accountId, eventId, attempt, result) {
      const { data, error } = await db
        .from('meta_conversion_events')
        .update(result)
        .eq('id', eventId)
        .eq('account_id', accountId)
        .eq('status', 'sending')
        .eq('attempts', attempt)
        .select('id')
        .maybeSingle();
      assertDatabaseResult('persist_attempt_result', error);
      return data !== null;
    },

    async recoverStaleSending(staleBefore) {
      const { data, error } = await db
        .from('meta_conversion_events')
        .update({
          status: 'delivery_unknown',
          error_message: 'delivery_unknown_worker_crash',
        })
        .eq('status', 'sending')
        .lt('updated_at', staleBefore)
        .select('id');
      assertDatabaseResult('recover_stale_sending', error);
      return data?.length ?? 0;
    },

    async listPending(limit) {
      const safeLimit = Math.max(1, Math.min(limit, 25));
      const { data, error } = await db
        .from('meta_conversion_events')
        .select('id,account_id')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(safeLimit);
      assertDatabaseResult('list_pending', error);
      return (data ?? []) as MetaConversionCandidate[];
    },
  };
}

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parsePurchaseValue(value: number | string | null): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

export function buildMetaConversionPayload(
  event: StoredMetaConversionEvent,
  attribution: StoredMetaConversionAttribution
): MetaConversionsRequest | null {
  const eventTimeMs = Date.parse(event.event_time);
  if (
    !Number.isFinite(eventTimeMs) ||
    eventTimeMs < 0 ||
    !['LeadSubmitted', 'QualifiedLead', 'Purchase'].includes(
      event.event_name
    ) ||
    !isNonEmpty(event.event_id) ||
    !isNonEmpty(attribution.waba_id) ||
    !isNonEmpty(attribution.ctwa_clid)
  ) {
    return null;
  }

  const data: MetaConversionsRequest['data'][0] = {
    event_name: event.event_name,
    event_time: Math.floor(eventTimeMs / 1_000),
    event_id: event.event_id,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: {
      whatsapp_business_account_id: attribution.waba_id,
      ctwa_clid: attribution.ctwa_clid,
    },
  };

  if (event.event_name === 'Purchase') {
    const value = parsePurchaseValue(event.value);
    if (
      value === null ||
      !event.currency ||
      !/^[A-Z]{3}$/.test(event.currency)
    ) {
      return null;
    }
    data.custom_data = { value, currency: event.currency };
  }

  return { data: [data] };
}

function logResult(
  event: StoredMetaConversionEvent,
  attempt: number,
  result: MetaConversionDeliveryResult,
  persistedStatus: 'sent' | 'failed' | 'delivery_unknown'
): void {
  console.info('[meta-conversions][send]', {
    account_id: event.account_id,
    event_db_id: event.id,
    event_id: event.event_id,
    event_name: event.event_name,
    attempt,
    http_status: result.httpStatus,
    meta_error_code: result.metaCode,
    meta_error_subcode: result.metaSubcode,
    result: persistedStatus,
  });
}

async function markPreflight(
  repository: MetaConversionEventRepository,
  event: StoredMetaConversionEvent,
  status: Extract<
    MetaConversionEventStatus,
    | 'failed'
    | 'delivery_unknown'
    | 'skipped_disabled'
    | 'skipped_missing_config'
    | 'skipped_no_attribution'
  >,
  error: string
): Promise<MetaConversionProcessingResult> {
  const updated = await repository.markBeforeAttempt(
    event.account_id,
    event.id,
    event.attempts,
    status,
    error
  );
  if (!updated) return { status: 'busy' };
  return status === 'failed' || status === 'delivery_unknown'
    ? { status, attempt: null }
    : { status };
}

export async function processMetaConversionEvent(options: {
  repository: MetaConversionEventRepository;
  accountId: string;
  eventDbId: string;
  decryptToken?: (ciphertext: string) => string;
  deliver?: (input: {
    datasetId: string;
    accessToken: string;
    payload: MetaConversionsRequest;
  }) => Promise<MetaConversionDeliveryResult>;
  now?: () => Date;
}): Promise<MetaConversionProcessingResult> {
  const {
    repository,
    accountId,
    eventDbId,
    decryptToken = decrypt,
    deliver = sendMetaConversionEvent,
    now = () => new Date(),
  } = options;

  const event = await repository.getEvent(accountId, eventDbId);
  if (!event) return { status: 'not_found' };
  if (event.status !== 'pending') return { status: 'ignored' };

  // Stage 12 may have persisted an attempted POST as pending. Business
  // Messaging does not deduplicate repeated server events by event_id, so a
  // legacy attempted row is quarantined instead of being sent again.
  if (event.attempts > 0) {
    return markPreflight(
      repository,
      event,
      'delivery_unknown',
      'delivery_unknown_previous_attempt'
    );
  }

  const config = await repository.getConfig(accountId);
  if (
    !config ||
    !isNonEmpty(config.dataset_id) ||
    !isNonEmpty(config.access_token)
  ) {
    return markPreflight(
      repository,
      event,
      'skipped_missing_config',
      'conversion_config_missing'
    );
  }
  if (!config.enabled) {
    return markPreflight(
      repository,
      event,
      'skipped_disabled',
      'conversion_config_disabled'
    );
  }

  if (!event.attribution_id) {
    return markPreflight(
      repository,
      event,
      'skipped_no_attribution',
      'conversion_attribution_missing'
    );
  }
  const attribution = await repository.getAttribution(
    accountId,
    event.attribution_id
  );
  if (
    !attribution ||
    !isNonEmpty(attribution.ctwa_clid) ||
    !isNonEmpty(attribution.waba_id)
  ) {
    return markPreflight(
      repository,
      event,
      'skipped_no_attribution',
      'conversion_attribution_missing'
    );
  }

  const payload = buildMetaConversionPayload(event, attribution);
  if (!payload) {
    return markPreflight(
      repository,
      event,
      'failed',
      'invalid_conversion_event_snapshot'
    );
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(config.access_token);
  } catch {
    return markPreflight(
      repository,
      event,
      'failed',
      'conversion_access_token_unavailable'
    );
  }
  if (!accessToken.trim()) {
    return markPreflight(
      repository,
      event,
      'failed',
      'conversion_access_token_unavailable'
    );
  }

  const attempt = event.attempts + 1;
  const claimed = await repository.claimAttempt(
    accountId,
    eventDbId,
    event.attempts
  );
  if (!claimed) return { status: 'busy' };

  let delivery: MetaConversionDeliveryResult;
  try {
    delivery = await deliver({
      datasetId: config.dataset_id,
      accessToken,
      payload,
    });
  } catch {
    // Defensively treat a custom/throwing transport exactly like fetch's
    // ambiguous network path; the claim proves an HTTP attempt may have begun.
    delivery = {
      classification: 'DELIVERY_UNKNOWN',
      httpStatus: null,
      response: null,
      errorMessage: 'Meta Conversions API transport failed',
      errorCode: 'delivery_unknown_network',
    };
  }
  const status =
    delivery.classification === 'SUCCESS'
      ? 'sent'
      : delivery.classification === 'DEFINITE_REJECTION'
        ? 'failed'
        : 'delivery_unknown';
  const persisted = await repository.persistAttemptResult(
    accountId,
    eventDbId,
    attempt,
    {
      status,
      sent_at: status === 'sent' ? now().toISOString() : null,
      meta_http_status: delivery.httpStatus,
      meta_response: delivery.response,
      error_message:
        status === 'sent'
          ? null
          : status === 'delivery_unknown'
            ? (delivery.errorCode ?? 'delivery_unknown_ambiguous_response')
            : sanitizeMetaConversionText(delivery.errorMessage, [
                accessToken,
                config.access_token,
                attribution.ctwa_clid,
              ]),
    }
  );
  logResult(event, attempt, delivery, status);
  if (!persisted) return { status: 'busy' };
  return { status, attempt };
}

export async function processMetaConversionEventBatch(options: {
  repository: MetaConversionEventRepository;
  batchSize?: number;
  processOne?: (
    candidate: MetaConversionCandidate
  ) => Promise<MetaConversionProcessingResult>;
  now?: () => Date;
}): Promise<MetaConversionBatchResult> {
  const {
    repository,
    batchSize = META_CONVERSION_EVENT_BATCH_SIZE,
    now = () => new Date(),
  } = options;
  const staleBefore = new Date(
    now().getTime() - META_CONVERSION_EVENT_CLAIM_LEASE_MS
  ).toISOString();
  const recoveredSending = await repository.recoverStaleSending(staleBefore);
  const candidates = await repository.listPending(batchSize);
  const summary: MetaConversionBatchResult = {
    recovered_sending: recoveredSending,
    scanned: candidates.length,
    sent: 0,
    failed: 0,
    delivery_unknown: recoveredSending,
    skipped_disabled: 0,
    skipped_missing_config: 0,
    skipped_no_attribution: 0,
    busy: 0,
    ignored: 0,
    not_found: 0,
    errors: 0,
  };

  for (const candidate of candidates) {
    try {
      const result = options.processOne
        ? await options.processOne(candidate)
        : await processMetaConversionEvent({
            repository,
            accountId: candidate.account_id,
            eventDbId: candidate.id,
          });
      summary[result.status]++;
    } catch (error) {
      summary.errors++;
      console.error('[meta-conversions][delivery] batch item failed', {
        account_id: candidate.account_id,
        event_db_id: candidate.id,
        result: 'error',
        error_code:
          error && typeof error === 'object' && 'code' in error
            ? String(error.code).slice(0, 64)
            : 'unknown',
      });
    }
  }

  return summary;
}
