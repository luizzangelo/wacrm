import type { SupabaseClient } from '@supabase/supabase-js';
import { META_CONVERSION_EVENT_CLAIM_LEASE_MS } from './constants';
import {
  DIAGNOSTIC_EVENTS,
  DIAGNOSTIC_STATUSES,
  type DiagnosticEventName,
  type DiagnosticStatus,
  type EventDiagnostic,
  type EventDiagnosticsPage,
} from './event-diagnostics-types';

export class DiagnosticFilterError extends Error {}
export interface DiagnosticFilters {
  page: number;
  pageSize: number;
  status?: DiagnosticStatus;
  eventName?: DiagnosticEventName;
  from?: string;
  until?: string;
}

export function parseDiagnosticFilters(
  params: URLSearchParams
): DiagnosticFilters {
  function integer(key: string, fallback: number, max: number) {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max) {
      throw new DiagnosticFilterError('Filtros inválidos');
    }
    return Number(raw);
  }
  function date(key: string) {
    const raw = params.get(key);
    if (!raw) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new DiagnosticFilterError();
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== raw
    ) {
      throw new DiagnosticFilterError();
    }
    return parsed;
  }
  const status = params.get('status') || undefined;
  const eventName = params.get('event_name') || undefined;
  if (status && !DIAGNOSTIC_STATUSES.includes(status as DiagnosticStatus))
    throw new DiagnosticFilterError();
  if (
    eventName &&
    !DIAGNOSTIC_EVENTS.includes(eventName as DiagnosticEventName)
  )
    throw new DiagnosticFilterError();
  const from = date('from');
  const to = date('to');
  if (from && to && from > to) throw new DiagnosticFilterError();
  return {
    page: integer('page', 1, 100_000),
    pageSize: integer('page_size', 20, 50),
    status: status as DiagnosticStatus | undefined,
    eventName: eventName as DiagnosticEventName | undefined,
    from: from?.toISOString(),
    until: to ? new Date(to.getTime() + 86_400_000).toISOString() : undefined,
  };
}

type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {};
const uuid = (value: unknown): string | null =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
    ? value
    : null;
const integer = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
const timestamp = (value: unknown): string | null =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;

/** Closed vocabulary, not redaction: untrusted response/message text is never forwarded. */
export function serializeEventDiagnostic(
  row: Row,
  related: {
    contactId?: unknown;
    attributionPresent?: boolean;
    dealId?: unknown;
    pipeline?: string | null;
    stage?: string | null;
  } = {},
  now = Date.now()
): EventDiagnostic {
  const status = DIAGNOSTIC_STATUSES.includes(row.status as DiagnosticStatus)
    ? (row.status as DiagnosticStatus)
    : 'delivery_unknown';
  const eventName = DIAGNOSTIC_EVENTS.includes(
    row.event_name as DiagnosticEventName
  )
    ? (row.event_name as DiagnosticEventName)
    : 'LeadSubmitted';
  const error = object(object(row.meta_response).error);
  const code = integer(error.code);
  const updated = timestamp(row.updated_at);
  const age =
    status === 'sending' && updated
      ? Math.max(0, Math.floor((now - Date.parse(updated)) / 1000))
      : null;
  const messages: Partial<Record<DiagnosticStatus, string>> = {
    failed:
      code === 100
        ? 'Parâmetro rejeitado pela Meta. Confira o código e subcódigo.'
        : 'Tentativa encerrada sem sucesso. Confira os códigos disponíveis.',
    delivery_unknown:
      row.error_message === 'delivery_unknown_worker_crash'
        ? 'O worker não confirmou a conclusão antes do fim da lease.'
        : 'Não foi possível confirmar o resultado da tentativa.',
    skipped_disabled: 'Envio desativado no momento do processamento.',
    skipped_no_attribution: 'Atribuição CTWA indisponível.',
    skipped_missing_config: 'Configuração necessária indisponível.',
  };
  const id = uuid(row.id);
  const eventIdParts =
    typeof row.event_id === 'string' ? row.event_id.split(':') : [];
  const validEventId =
    eventIdParts.length === 4 &&
    eventIdParts[0] === 'meta' &&
    uuid(eventIdParts[1]) === uuid(row.account_id) &&
    uuid(eventIdParts[1]) !== null &&
    uuid(eventIdParts[2]) !== null &&
    eventIdParts[3] === eventName;
  return {
    id,
    event_name: eventName,
    status,
    attempts: integer(row.attempts) ?? 0,
    // Never slice arbitrary persisted text: it could itself contain secrets/PII.
    event_id_masked: validEventId
      ? `meta:${eventIdParts[1].slice(0, 8)}…:${eventIdParts[2].slice(0, 8)}…:${eventName}`
      : `meta:…:…:${eventName}`,
    event_time: timestamp(row.event_time),
    created_at: timestamp(row.created_at),
    updated_at: updated,
    sent_at: timestamp(row.sent_at),
    http_status: integer(row.meta_http_status),
    meta_error_code: code,
    meta_error_subcode: integer(error.error_subcode),
    diagnostic_message: messages[status] ?? null,
    deal_id: uuid(related.dealId),
    contact_id: uuid(related.contactId),
    attribution_present: related.attributionPresent === true,
    pipeline: related.pipeline ?? null,
    stage: related.stage ?? null,
    purchase:
      eventName === 'Purchase'
        ? {
            value:
              typeof row.value === 'number' && Number.isFinite(row.value)
                ? row.value
                : null,
            currency:
              typeof row.currency === 'string' &&
              /^[A-Z]{3}$/.test(row.currency)
                ? row.currency
                : null,
          }
        : null,
    sending_age_seconds: age,
    sending_stale:
      age !== null && age * 1000 > META_CONVERSION_EVENT_CLAIM_LEASE_MS,
  };
}

/** Uses caller's SSR/RLS client AND explicit tenant predicates; contains SELECTs only. */
export async function listEventDiagnostics(
  client: SupabaseClient,
  accountId: string,
  filters: DiagnosticFilters
): Promise<EventDiagnosticsPage> {
  const base = () =>
    client
      .from('meta_conversion_events')
      .select(
        'id,account_id,deal_id,attribution_id,event_name,status,attempts,event_time,created_at,updated_at,sent_at,value,currency,meta_http_status,meta_response,error_message',
        { count: 'exact' }
      )
      .eq('account_id', accountId);
  let query = base();
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.eventName) query = query.eq('event_name', filters.eventName);
  if (filters.from) query = query.gte('created_at', filters.from);
  if (filters.until) query = query.lt('created_at', filters.until);
  const offset = (filters.page - 1) * filters.pageSize;
  const [page, counts, config] = await Promise.all([
    query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + filters.pageSize - 1),
    Promise.all(
      DIAGNOSTIC_STATUSES.map(async (status) => {
        const result = await client
          .from('meta_conversion_events')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', accountId)
          .eq('status', status);
        if (result.error) throw new Error('Diagnostics count unavailable');
        return [status, result.count ?? 0] as const;
      })
    ),
    client
      .from('meta_conversion_config')
      .select('dataset_id')
      .eq('account_id', accountId)
      .maybeSingle(),
  ]);
  if (page.error || config.error) throw new Error('Diagnostics unavailable');
  const rows = (page.data ?? []) as Row[];
  const attributionIds = rows
    .map((row) => uuid(row.attribution_id))
    .filter((id): id is string => !!id);
  const dealIds = rows
    .map((row) => uuid(row.deal_id))
    .filter((id): id is string => !!id);
  const [attributions, deals] = await Promise.all([
    attributionIds.length
      ? client
          .from('meta_ad_attributions')
          .select('id,contact_id')
          .eq('account_id', accountId)
          .in('id', attributionIds)
      : { data: [], error: null },
    dealIds.length
      ? client
          .from('deals')
          .select('id,pipeline_id,stage_id')
          .eq('account_id', accountId)
          .in('id', dealIds)
      : { data: [], error: null },
  ]);
  if (attributions.error || deals.error)
    throw new Error('Diagnostics relations unavailable');
  const contactIds = (attributions.data ?? [])
    .map((row) => row.contact_id)
    .filter(Boolean);
  const pipelineIds = (deals.data ?? [])
    .map((row) => row.pipeline_id)
    .filter(Boolean);
  const [contacts, pipelines] = await Promise.all([
    contactIds.length
      ? client
          .from('contacts')
          .select('id')
          .eq('account_id', accountId)
          .in('id', contactIds)
      : { data: [], error: null },
    pipelineIds.length
      ? client
          .from('pipelines')
          .select('id,name')
          .eq('account_id', accountId)
          .in('id', pipelineIds)
      : { data: [], error: null },
  ]);
  if (contacts.error || pipelines.error)
    throw new Error('Diagnostics origins unavailable');
  const readablePipelines = (pipelines.data ?? []).map((row) => row.id);
  const stageIds = (deals.data ?? [])
    .map((row) => row.stage_id)
    .filter(Boolean);
  const stages = readablePipelines.length
    ? await client
        .from('pipeline_stages')
        .select('id,pipeline_id,name')
        .in('pipeline_id', readablePipelines)
        .in('id', stageIds)
    : { data: [], error: null };
  if (stages.error) throw new Error('Diagnostics stages unavailable');
  return {
    events: rows
      .filter((row) => row.account_id === accountId)
      .map((row) => {
        const attribution = attributions.data?.find(
          (a) => a.id === row.attribution_id
        );
        const contact = contacts.data?.find(
          (c) => c.id === attribution?.contact_id
        );
        const deal = deals.data?.find((d) => d.id === row.deal_id);
        const pipeline = pipelines.data?.find(
          (p) => p.id === deal?.pipeline_id
        );
        const stage = stages.data?.find(
          (s) => s.id === deal?.stage_id && s.pipeline_id === pipeline?.id
        );
        return serializeEventDiagnostic(row, {
          attributionPresent: !!attribution,
          contactId: contact?.id,
          dealId: deal?.id,
          pipeline: pipeline?.name ?? null,
          stage: stage?.name ?? null,
        });
      }),
    counts: Object.fromEntries(counts) as Record<DiagnosticStatus, number>,
    total: page.count ?? 0,
    page: filters.page,
    page_size: filters.pageSize,
    dataset_id:
      typeof config.data?.dataset_id === 'string' &&
      /^\d+$/.test(config.data.dataset_id)
        ? config.data.dataset_id
        : null,
  };
}
