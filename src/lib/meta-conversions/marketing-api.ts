import {
  META_CONVERSIONS_GRAPH_BASE,
  META_CONVERSIONS_REQUEST_TIMEOUT_MS,
} from './constants';

export interface MetaAdHierarchy {
  ad_id: string;
  ad_name: string;
  adset_id: string;
  adset_name: string;
  campaign_id: string;
  campaign_name: string;
}

export type MetaMarketingErrorKind =
  | 'http'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'incomplete_response'
  | 'invalid_attribution';

export interface MetaMarketingErrorDetails {
  kind: MetaMarketingErrorKind;
  http_status?: number;
  code?: number;
  subcode?: number;
  type?: string;
  message: string;
  fbtrace_id?: string;
}

export class MetaMarketingApiError extends Error {
  constructor(readonly details: MetaMarketingErrorDetails) {
    super('Meta Marketing API request failed');
    this.name = 'MetaMarketingApiError';
  }
}

interface MetaGraphErrorEnvelope {
  error?: {
    code?: unknown;
    error_subcode?: unknown;
    type?: unknown;
    message?: unknown;
    fbtrace_id?: unknown;
  };
}

interface MetaNamedObject {
  id?: unknown;
  name?: unknown;
}

interface MetaAdResponse extends MetaNamedObject {
  adset_id?: unknown;
  campaign_id?: unknown;
  adset?: MetaNamedObject;
  campaign?: MetaNamedObject;
}

const AD_FIELDS =
  'id,name,adset{id,name},campaign{id,name},adset_id,campaign_id';
const NAMED_OBJECT_FIELDS = 'id,name';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function sanitizeText(value: unknown, accessToken: string): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;

  let sanitized = value;
  if (accessToken) sanitized = sanitized.split(accessToken).join('[redacted]');
  sanitized = sanitized
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/access_token\s*[=:]\s*[^\s&,;]+/gi, 'access_token=[redacted]');

  return sanitized.slice(0, 500);
}

function sanitizeIdentifier(
  value: unknown,
  accessToken: string
): string | undefined {
  return sanitizeText(value, accessToken)?.slice(0, 128);
}

function httpErrorDetails(
  responseStatus: number,
  payload: MetaGraphErrorEnvelope,
  accessToken: string
): MetaMarketingErrorDetails {
  const metaError = payload.error;
  return {
    kind: 'http',
    http_status: responseStatus,
    code: optionalNumber(metaError?.code),
    subcode: optionalNumber(metaError?.error_subcode),
    type: sanitizeText(metaError?.type, accessToken),
    message:
      sanitizeText(metaError?.message, accessToken) ??
      'Meta Marketing API request failed',
    fbtrace_id: sanitizeIdentifier(metaError?.fbtrace_id, accessToken),
  };
}

async function readGraphObject<T extends object>(
  objectId: string,
  fields: string,
  accessToken: string,
  fetcher: typeof fetch
): Promise<T> {
  const url = new URL(
    `${META_CONVERSIONS_GRAPH_BASE}/${encodeURIComponent(objectId)}`
  );
  url.searchParams.set('fields', fields);

  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(META_CONVERSIONS_REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const errorName =
      error && typeof error === 'object' && 'name' in error
        ? String(error.name)
        : '';
    throw new MetaMarketingApiError({
      kind:
        errorName === 'AbortError' || errorName === 'TimeoutError'
          ? 'timeout'
          : 'network',
      message:
        errorName === 'AbortError' || errorName === 'TimeoutError'
          ? 'Meta Marketing API request timed out'
          : 'Meta Marketing API network request failed',
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) {
      throw new MetaMarketingApiError(
        httpErrorDetails(response.status, {}, accessToken)
      );
    }
    throw new MetaMarketingApiError({
      kind: 'invalid_response',
      http_status: response.status,
      message: 'Meta Marketing API returned invalid JSON',
    });
  }

  if (!response.ok) {
    const envelope =
      payload && typeof payload === 'object'
        ? (payload as MetaGraphErrorEnvelope)
        : {};
    throw new MetaMarketingApiError(
      httpErrorDetails(response.status, envelope, accessToken)
    );
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new MetaMarketingApiError({
      kind: 'invalid_response',
      http_status: response.status,
      message: 'Meta Marketing API returned an unexpected response',
    });
  }

  return payload as T;
}

function incompleteResponse(message: string): never {
  throw new MetaMarketingApiError({
    kind: 'incomplete_response',
    message,
  });
}

/**
 * Read the Ad and expand its Ad Set and Campaign in one request. If Meta omits
 * either nested name but returns its id, fetch only that missing object.
 */
export async function readMetaAdHierarchy(
  adId: string,
  accessToken: string,
  fetcher: typeof fetch = fetch
): Promise<MetaAdHierarchy> {
  const ad = await readGraphObject<MetaAdResponse>(
    adId,
    AD_FIELDS,
    accessToken,
    fetcher
  );

  const resolvedAdId = optionalString(ad.id);
  const adName = optionalString(ad.name);
  const adsetId = optionalString(ad.adset?.id) ?? optionalString(ad.adset_id);
  const campaignId =
    optionalString(ad.campaign?.id) ?? optionalString(ad.campaign_id);
  let adsetName = optionalString(ad.adset?.name);
  let campaignName = optionalString(ad.campaign?.name);

  if (!resolvedAdId || !adName || !adsetId || !campaignId) {
    incompleteResponse('Ad response is missing required hierarchy fields');
  }

  const [adsetFallback, campaignFallback] = await Promise.all([
    adsetName
      ? Promise.resolve(null)
      : readGraphObject<MetaNamedObject>(
          adsetId,
          NAMED_OBJECT_FIELDS,
          accessToken,
          fetcher
        ),
    campaignName
      ? Promise.resolve(null)
      : readGraphObject<MetaNamedObject>(
          campaignId,
          NAMED_OBJECT_FIELDS,
          accessToken,
          fetcher
        ),
  ]);

  adsetName = adsetName ?? optionalString(adsetFallback?.name);
  campaignName = campaignName ?? optionalString(campaignFallback?.name);
  if (!adsetName || !campaignName) {
    incompleteResponse('Ad hierarchy names are incomplete');
  }

  return {
    ad_id: resolvedAdId,
    ad_name: adName,
    adset_id: adsetId,
    adset_name: adsetName,
    campaign_id: campaignId,
    campaign_name: campaignName,
  };
}
