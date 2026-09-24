import type { EmbeddedSignupServerConfig } from './embedded-signup-config';

const REQUEST_TIMEOUT_MS = 15_000;

interface GraphErrorEnvelope {
  error?: {
    code?: number;
    error_subcode?: number;
    type?: string;
  };
}

export class EmbeddedSignupMetaError extends Error {
  constructor(
    readonly reason:
      | 'exchange_rejected'
      | 'exchange_outcome_unknown'
      | 'invalid_token'
      | 'missing_permissions'
      | 'invalid_waba'
      | 'phone_discovery_failed'
      | 'invalid_phone'
      | 'registration_failed'
      | 'subscription_failed'
      | 'subscription_not_confirmed'
      | 'sync_failed'
      | 'sync_outcome_unknown',
    readonly httpStatus?: number,
    readonly metaCode?: number,
    readonly metaSubcode?: number
  ) {
    super(reason);
    this.name = 'EmbeddedSignupMetaError';
  }
}

async function parseGraphError(
  response: Response
): Promise<GraphErrorEnvelope> {
  try {
    return (await response.json()) as GraphErrorEnvelope;
  } catch {
    return {};
  }
}

function metaError(
  reason: EmbeddedSignupMetaError['reason'],
  response: Response,
  data: GraphErrorEnvelope
) {
  return new EmbeddedSignupMetaError(
    reason,
    response.status,
    data.error?.code,
    data.error?.error_subcode
  );
}

async function graphFetch(
  url: string,
  init: RequestInit,
  ambiguousReason:
    'exchange_outcome_unknown' | 'sync_outcome_unknown' | null = null
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (ambiguousReason) throw new EmbeddedSignupMetaError(ambiguousReason);
    throw error;
  }
}

export interface ExchangedToken {
  accessToken: string;
  tokenType: string | null;
  expiresAt: string | null;
}

/** Official Facebook Login for Business authorization-code exchange. */
export async function exchangeAuthorizationCode(
  config: EmbeddedSignupServerConfig,
  code: string
): Promise<ExchangedToken> {
  const url = new URL(
    `https://graph.facebook.com/${config.graphVersion}/oauth/access_token`
  );
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('client_secret', config.appSecret);
  url.searchParams.set('code', code);
  url.searchParams.set('redirect_uri', config.redirectUri);

  const response = await graphFetch(
    url.toString(),
    { method: 'GET' },
    'exchange_outcome_unknown'
  );
  if (!response.ok) {
    const data = await parseGraphError(response);
    throw metaError('exchange_rejected', response, data);
  }
  const data = (await response.json()) as {
    access_token?: unknown;
    token_type?: unknown;
    expires_in?: unknown;
  };
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new EmbeddedSignupMetaError('exchange_rejected', response.status);
  }
  const expiresAt =
    typeof data.expires_in === 'number' && Number.isFinite(data.expires_in)
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null;
  return {
    accessToken: data.access_token,
    tokenType: typeof data.token_type === 'string' ? data.token_type : null,
    expiresAt,
  };
}

export interface ValidatedToken {
  scopes: string[];
  granularWabaIds: string[];
}

export async function validateAccessToken(
  config: EmbeddedSignupServerConfig,
  accessToken: string
): Promise<ValidatedToken> {
  const url = new URL(
    `https://graph.facebook.com/${config.graphVersion}/debug_token`
  );
  url.searchParams.set('input_token', accessToken);
  const response = await graphFetch(url.toString(), {
    headers: { Authorization: `Bearer ${config.appId}|${config.appSecret}` },
  });
  if (!response.ok) {
    throw metaError('invalid_token', response, await parseGraphError(response));
  }
  const body = (await response.json()) as {
    data?: {
      app_id?: unknown;
      is_valid?: unknown;
      scopes?: unknown;
      granular_scopes?: unknown;
    };
  };
  const data = body.data;
  if (!data || data.is_valid !== true || String(data.app_id) !== config.appId) {
    throw new EmbeddedSignupMetaError('invalid_token', response.status);
  }
  const scopes = Array.isArray(data.scopes)
    ? data.scopes.filter((value): value is string => typeof value === 'string')
    : [];
  const required = [
    'whatsapp_business_management',
    'whatsapp_business_messaging',
  ];
  if (required.some((scope) => !scopes.includes(scope))) {
    throw new EmbeddedSignupMetaError('missing_permissions', response.status);
  }
  const granularWabaIds = Array.isArray(data.granular_scopes)
    ? data.granular_scopes.flatMap((scope) => {
        if (!scope || typeof scope !== 'object') return [];
        const record = scope as { scope?: unknown; target_ids?: unknown };
        if (
          record.scope !== 'whatsapp_business_management' ||
          !Array.isArray(record.target_ids)
        ) {
          return [];
        }
        return record.target_ids.filter(
          (value): value is string => typeof value === 'string'
        );
      })
    : [];
  return { scopes, granularWabaIds };
}

export interface EmbeddedPhoneNumber {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  isOnBizApp: boolean;
  platformType: string | null;
}

export async function discoverWabaPhoneNumbers(
  config: EmbeddedSignupServerConfig,
  accessToken: string,
  wabaId: string
): Promise<EmbeddedPhoneNumber[]> {
  const url = new URL(
    `https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(wabaId)}/phone_numbers`
  );
  url.searchParams.set(
    'fields',
    'id,display_phone_number,verified_name,is_on_biz_app,platform_type'
  );
  const response = await graphFetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw metaError('invalid_waba', response, await parseGraphError(response));
  }
  const body = (await response.json()) as { data?: unknown };
  if (!Array.isArray(body.data)) {
    throw new EmbeddedSignupMetaError(
      'phone_discovery_failed',
      response.status
    );
  }
  return body.data.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const phone = value as Record<string, unknown>;
    if (
      typeof phone.id !== 'string' ||
      typeof phone.display_phone_number !== 'string'
    ) {
      return [];
    }
    return [
      {
        id: phone.id,
        displayPhoneNumber: phone.display_phone_number,
        verifiedName:
          typeof phone.verified_name === 'string' ? phone.verified_name : null,
        isOnBizApp: phone.is_on_biz_app === true,
        platformType:
          typeof phone.platform_type === 'string' ? phone.platform_type : null,
      },
    ];
  });
}

export async function subscribeAndConfirmWaba(
  config: EmbeddedSignupServerConfig,
  accessToken: string,
  wabaId: string
): Promise<void> {
  const endpoint = `https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(wabaId)}/subscribed_apps`;
  const posted = await graphFetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!posted.ok) {
    throw metaError(
      'subscription_failed',
      posted,
      await parseGraphError(posted)
    );
  }

  const checked = await graphFetch(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!checked.ok) {
    throw metaError(
      'subscription_not_confirmed',
      checked,
      await parseGraphError(checked)
    );
  }
  const body = (await checked.json()) as { data?: unknown };
  const subscribed = Array.isArray(body.data)
    ? body.data.some((item) => {
        if (!item || typeof item !== 'object') return false;
        const value = item as Record<string, unknown>;
        if (String(value.id ?? '') === config.appId) return true;
        const nested = value.whatsapp_business_api_data;
        return (
          !!nested &&
          typeof nested === 'object' &&
          String((nested as Record<string, unknown>).id ?? '') === config.appId
        );
      })
    : false;
  if (!subscribed)
    throw new EmbeddedSignupMetaError('subscription_not_confirmed');
}

export type CoexistenceSyncType = 'smb_app_state_sync' | 'history';

export async function requestCoexistenceSync(
  config: EmbeddedSignupServerConfig,
  accessToken: string,
  phoneNumberId: string,
  syncType: CoexistenceSyncType
): Promise<string | null> {
  const endpoint = `https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(phoneNumberId)}/smb_app_data`;
  const response = await graphFetch(
    endpoint,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        sync_type: syncType,
      }),
    },
    'sync_outcome_unknown'
  );
  if (!response.ok) {
    throw metaError('sync_failed', response, await parseGraphError(response));
  }
  const body = (await response.json()) as { request_id?: unknown };
  return typeof body.request_id === 'string' ? body.request_id : null;
}
