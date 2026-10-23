import type { MetaAdsServerConfig } from './config';

const TIMEOUT_MS = 10_000;

export interface MetaAdAccountChoice {
  id: string;
  name: string;
  accountStatus: number | null;
}

export class MetaAdsApiError extends Error {
  constructor(
    readonly publicCode: string,
    readonly status = 502,
    readonly metaCode?: number,
    readonly metaSubcode?: number
  ) {
    super(publicCode);
    this.name = 'MetaAdsApiError';
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

async function graphJson(
  url: URL,
  init: RequestInit,
  fetcher: typeof fetch
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new MetaAdsApiError('meta_network_error');
  }
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok || !payload) {
    const error = payload?.error as Record<string, unknown> | undefined;
    throw new MetaAdsApiError(
      'meta_request_failed',
      502,
      numberValue(error?.code),
      numberValue(error?.error_subcode)
    );
  }
  return payload;
}

export async function exchangeMetaAdsCode(
  config: MetaAdsServerConfig,
  code: string,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const url = new URL(
    `https://graph.facebook.com/${config.graphVersion}/oauth/access_token`
  );
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('client_secret', config.appSecret);
  url.searchParams.set('code', code);
  const payload = await graphJson(url, { method: 'GET' }, fetcher);
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new MetaAdsApiError('token_exchange_invalid');
  }
  return payload.access_token;
}

export async function discoverMetaAdAccounts(
  config: MetaAdsServerConfig,
  token: string,
  fetcher: typeof fetch = fetch
): Promise<MetaAdAccountChoice[]> {
  const debugUrl = new URL(
    `https://graph.facebook.com/${config.graphVersion}/debug_token`
  );
  debugUrl.searchParams.set('input_token', token);
  debugUrl.searchParams.set(
    'access_token',
    `${config.appId}|${config.appSecret}`
  );
  const debug = await graphJson(debugUrl, { method: 'GET' }, fetcher);
  const data = debug.data as Record<string, unknown> | undefined;
  if (data?.is_valid !== true)
    throw new MetaAdsApiError('invalid_access_token', 400);
  const scopes = Array.isArray(data.granular_scopes)
    ? data.granular_scopes
    : [];
  const adsRead = scopes.find(
    (scope) =>
      scope &&
      typeof scope === 'object' &&
      (scope as Record<string, unknown>).scope === 'ads_read'
  ) as Record<string, unknown> | undefined;
  const targetIds = Array.isArray(adsRead?.target_ids)
    ? [
        ...new Set(
          adsRead.target_ids.filter(
            (id): id is string =>
              typeof id === 'string' && /^\d{5,30}$/.test(id)
          )
        ),
      ]
    : [];
  if (!adsRead) throw new MetaAdsApiError('ads_read_missing', 400);
  if (!targetIds.length) throw new MetaAdsApiError('no_ad_accounts', 400);

  return Promise.all(
    targetIds.map(async (id) => {
      const url = new URL(
        `https://graph.facebook.com/${config.graphVersion}/act_${id}`
      );
      url.searchParams.set('fields', 'name,account_id,account_status');
      const account = await graphJson(
        url,
        { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
        fetcher
      );
      return {
        id: typeof account.account_id === 'string' ? account.account_id : id,
        name:
          typeof account.name === 'string' && account.name.trim()
            ? account.name.trim()
            : `act_${id}`,
        accountStatus: numberValue(account.account_status) ?? null,
      };
    })
  );
}

export async function revokeMetaAdsToken(
  config: MetaAdsServerConfig,
  token: string,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const url = new URL(
    `https://graph.facebook.com/${config.graphVersion}/me/permissions`
  );
  await graphJson(
    url,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    fetcher
  );
}
