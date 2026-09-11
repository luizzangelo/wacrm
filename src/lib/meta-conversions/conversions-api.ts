import {
  META_CONVERSIONS_GRAPH_BASE,
  META_CONVERSIONS_REQUEST_TIMEOUT_MS,
} from './constants';

export interface MetaBusinessMessagingEvent {
  event_name: 'LeadSubmitted' | 'QualifiedLead' | 'Purchase';
  event_time: number;
  event_id: string;
  action_source: 'business_messaging';
  messaging_channel: 'whatsapp';
  user_data: {
    whatsapp_business_account_id: string;
    ctwa_clid: string;
  };
  custom_data?: {
    value: number;
    currency: string;
  };
}

export interface MetaConversionsRequest {
  data: [MetaBusinessMessagingEvent];
}

export interface SanitizedMetaConversionsResponse {
  events_received?: number;
  messages?: string[];
  fbtrace_id?: string;
  error?: {
    code?: number;
    error_subcode?: number;
    type?: string;
  };
}

export type MetaConversionDeliveryClassification =
  'SUCCESS' | 'RETRYABLE' | 'PERMANENT';

export interface MetaConversionDeliveryResult {
  classification: MetaConversionDeliveryClassification;
  httpStatus: number | null;
  response: SanitizedMetaConversionsResponse | null;
  errorMessage: string | null;
  metaCode?: number;
  metaSubcode?: number;
}

interface MetaErrorEnvelope {
  error?: {
    code?: unknown;
    error_subcode?: unknown;
    type?: unknown;
    message?: unknown;
    fbtrace_id?: unknown;
  };
  events_received?: unknown;
  messages?: unknown;
  fbtrace_id?: unknown;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeText(value: unknown, secrets: string[]): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;

  let sanitized = value
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/access_token\s*[=:]\s*[^\s&,;]+/gi, 'access_token=[redacted]');

  for (const secret of secrets) {
    if (!secret) continue;
    sanitized = sanitized.replace(
      new RegExp(escapeRegExp(secret), 'g'),
      '[redacted]'
    );
  }

  return sanitized.slice(0, 500);
}

export function sanitizeMetaConversionText(
  value: unknown,
  secrets: string[] = []
): string {
  return sanitizeText(value, secrets) ?? 'Meta Conversions API request failed';
}

function safeIdentifier(value: unknown, secrets: string[]): string | undefined {
  return sanitizeText(value, secrets)?.slice(0, 128);
}

function sanitizeResponse(
  body: MetaErrorEnvelope | null,
  secrets: string[]
): SanitizedMetaConversionsResponse | null {
  if (!body) return null;

  const response: SanitizedMetaConversionsResponse = {};
  const eventsReceived = numberOrUndefined(body.events_received);
  if (eventsReceived !== undefined) response.events_received = eventsReceived;

  if (Array.isArray(body.messages)) {
    const messages = body.messages
      .slice(0, 10)
      .map((message) => sanitizeText(message, secrets))
      .filter((message): message is string => Boolean(message));
    if (messages.length) response.messages = messages;
  }

  const fbtraceId = safeIdentifier(
    body.fbtrace_id ?? body.error?.fbtrace_id,
    secrets
  );
  if (fbtraceId) response.fbtrace_id = fbtraceId;

  if (body.error) {
    const error = {
      code: numberOrUndefined(body.error.code),
      error_subcode: numberOrUndefined(body.error.error_subcode),
      type: safeIdentifier(body.error.type, secrets),
    };
    if (Object.values(error).some((value) => value !== undefined)) {
      response.error = error;
    }
  }

  return Object.keys(response).length ? response : null;
}

function classifyHttpStatus(status: number): 'RETRYABLE' | 'PERMANENT' {
  if (status === 429 || status >= 500) return 'RETRYABLE';
  return 'PERMANENT';
}

async function readJson(response: Response): Promise<MetaErrorEnvelope | null> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as MetaErrorEnvelope)
      : null;
  } catch {
    return null;
  }
}

export async function sendMetaConversionEvent(options: {
  datasetId: string;
  accessToken: string;
  payload: MetaConversionsRequest;
  fetcher?: typeof fetch;
}): Promise<MetaConversionDeliveryResult> {
  const { datasetId, accessToken, payload, fetcher = fetch } = options;
  const endpoint = `${META_CONVERSIONS_GRAPH_BASE}/${encodeURIComponent(datasetId)}/events`;
  const secrets = [accessToken, payload.data[0].user_data.ctwa_clid];

  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(META_CONVERSIONS_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError');
    return {
      classification: 'RETRYABLE',
      httpStatus: null,
      response: null,
      errorMessage: timedOut
        ? 'Meta Conversions API request timed out'
        : 'Meta Conversions API network request failed',
    };
  }

  const body = await readJson(response);
  const sanitized = sanitizeResponse(body, secrets);
  const eventsReceived = numberOrUndefined(body?.events_received);
  const hasMetaError = Boolean(body?.error);

  if (
    response.ok &&
    !hasMetaError &&
    eventsReceived !== undefined &&
    eventsReceived > 0
  ) {
    return {
      classification: 'SUCCESS',
      httpStatus: response.status,
      response: sanitized,
      errorMessage: null,
    };
  }

  const classification = response.ok
    ? 'PERMANENT'
    : classifyHttpStatus(response.status);
  const metaMessage = sanitizeText(body?.error?.message, secrets);
  return {
    classification,
    httpStatus: response.status,
    response: sanitized,
    errorMessage:
      metaMessage ??
      (response.ok
        ? 'Meta Conversions API did not confirm event receipt'
        : `Meta Conversions API HTTP ${response.status}`),
    metaCode: numberOrUndefined(body?.error?.code),
    metaSubcode: numberOrUndefined(body?.error?.error_subcode),
  };
}
