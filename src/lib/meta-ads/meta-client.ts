import type { MetaAdsServerConfig } from './config';

const TIMEOUT_MS = 10_000;

export interface MetaAdAccountChoice {
  id: string;
  name: string;
  accountStatus: number | null;
}

interface GraphCollection {
  data?: unknown[];
}

interface DebugScope {
  scope: string;
  targetIds: string[];
}

interface LoggedGraphResult {
  ok: boolean;
  status: number | null;
  payload: Record<string, unknown> | null;
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

function stringId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/^act_/, '');
  return /^\d{5,30}$/.test(normalized) ? normalized : null;
}

function uniqueIds(values: unknown[]): string[] {
  return [
    ...new Set(values.map(stringId).filter((id): id is string => Boolean(id))),
  ];
}

function debugScopes(value: unknown): DebugScope[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    if (typeof record.scope !== 'string') return [];
    return [
      {
        scope: record.scope,
        targetIds: Array.isArray(record.target_ids)
          ? uniqueIds(record.target_ids)
          : [],
      },
    ];
  });
}

function records(payload: Record<string, unknown>): Record<string, unknown>[] {
  const data = (payload as GraphCollection).data;
  return Array.isArray(data)
    ? data.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object'
      )
    : [];
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

async function loggedGraphJson(
  endpoint: string,
  url: URL,
  init: RequestInit,
  fetcher: typeof fetch
): Promise<LoggedGraphResult> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    const logEntry = {
      endpoint,
      http_status: null,
      data_count: null,
      error: { code: null, error_subcode: null, message: 'network_error' },
    };
    console.info('[meta-ads/graph-call]', JSON.stringify(logEntry));
    return { ok: false, status: null, payload: null };
  }
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const rawError = payload?.error as Record<string, unknown> | undefined;
  const error =
    !response.ok || !payload
      ? {
          code: numberValue(rawError?.code) ?? null,
          error_subcode: numberValue(rawError?.error_subcode) ?? null,
          message:
            typeof rawError?.message === 'string'
              ? rawError.message
              : 'invalid_meta_response',
        }
      : null;
  const logEntry = {
    endpoint,
    http_status: response.status,
    data_count:
      payload && Array.isArray(payload.data) ? payload.data.length : null,
    error,
  };
  console.info('[meta-ads/graph-call]', JSON.stringify(logEntry));
  return {
    ok: response.ok && Boolean(payload),
    status: response.status,
    payload,
  };
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

async function readAccessibleAccounts(
  config: MetaAdsServerConfig,
  token: string,
  candidateIds: string[],
  fetcher: typeof fetch
): Promise<MetaAdAccountChoice[]> {
  const accessibleAccounts: MetaAdAccountChoice[] = [];
  for (const id of candidateIds) {
    const url = new URL(
      `https://graph.facebook.com/${config.graphVersion}/act_${id}`
    );
    url.searchParams.set('fields', 'name,account_id,account_status');
    const result = await loggedGraphJson(
      `/act_${id}`,
      url,
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
      fetcher
    );
    const account = result.payload;
    if (!result.ok || !account) continue;
    accessibleAccounts.push({
      id: typeof account.account_id === 'string' ? account.account_id : id,
      name:
        typeof account.name === 'string' && account.name.trim()
          ? account.name.trim()
          : `act_${id}`,
      accountStatus: numberValue(account.account_status) ?? null,
    });
  }
  return accessibleAccounts;
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
  const scopes = Array.isArray(data.scopes)
    ? data.scopes.filter((scope): scope is string => typeof scope === 'string')
    : [];
  const granularScopes = debugScopes(data.granular_scopes);
  const debugLog = {
    type: typeof data.type === 'string' ? data.type : null,
    scopes,
    granular_scopes: granularScopes.map(({ scope, targetIds }) => ({
      scope,
      target_ids: targetIds,
    })),
  };
  console.info('[meta-ads/debug-token]', JSON.stringify(debugLog));
  let successfulDiscoveryCall = false;
  let discoveredCandidate = false;

  async function acceptRoute(
    route: 'me_adaccounts' | 'business_accounts',
    candidateIds: string[]
  ) {
    if (!candidateIds.length) return null;
    discoveredCandidate = true;
    const accessibleAccounts = await readAccessibleAccounts(
      config,
      token,
      candidateIds,
      fetcher
    );
    if (!accessibleAccounts.length) return null;
    console.info('[meta-ads/account-discovery]', {
      route,
      candidates: candidateIds.length,
      accessible: accessibleAccounts.length,
    });
    return accessibleAccounts;
  }

  const accountsUrl = new URL(
    `https://graph.facebook.com/${config.graphVersion}/me/adaccounts`
  );
  accountsUrl.searchParams.set('fields', 'name,account_id,account_status');
  accountsUrl.searchParams.set('limit', '100');
  const directResult = await loggedGraphJson(
    '/me/adaccounts',
    accountsUrl,
    { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    fetcher
  );
  successfulDiscoveryCall ||= directResult.ok;
  if (directResult.ok && directResult.payload) {
    const directAccounts = await acceptRoute(
      'me_adaccounts',
      uniqueIds(
        records(directResult.payload).flatMap((account) => [
          account.account_id,
          account.id,
        ])
      )
    );
    if (directAccounts) return directAccounts;
  }

  let businessIds = granularScopes.find(
    (scope) => scope.scope === 'business_management'
  )?.targetIds;
  if (!businessIds?.length) {
    try {
      const businessesUrl = new URL(
        `https://graph.facebook.com/${config.graphVersion}/me/businesses`
      );
      businessesUrl.searchParams.set('fields', 'id');
      businessesUrl.searchParams.set('limit', '100');
      const result = await loggedGraphJson(
        '/me/businesses',
        businessesUrl,
        { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
        fetcher
      );
      if (result.ok && result.payload) {
        businessIds = uniqueIds(
          records(result.payload).map((business) => business.id)
        );
      } else {
        businessIds = [];
      }
    } catch {
      businessIds = [];
    }
  }

  const businessAccountIds: string[] = [];
  for (const businessId of businessIds ?? []) {
    for (const edge of ['owned_ad_accounts', 'client_ad_accounts']) {
      try {
        const url = new URL(
          `https://graph.facebook.com/${config.graphVersion}/${businessId}/${edge}`
        );
        url.searchParams.set('fields', 'name,account_id,account_status');
        url.searchParams.set('limit', '100');
        const result = await loggedGraphJson(
          `/${businessId}/${edge}`,
          url,
          { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
          fetcher
        );
        successfulDiscoveryCall ||= result.ok;
        if (!result.ok || !result.payload) continue;
        businessAccountIds.push(
          ...uniqueIds(
            records(result.payload).flatMap((account) => [
              account.account_id,
              account.id,
            ])
          )
        );
      } catch {
        // An unavailable edge must not prevent trying the other business edge.
      }
    }
  }
  const businessAccounts = await acceptRoute(
    'business_accounts',
    uniqueIds(businessAccountIds)
  );
  if (businessAccounts) return businessAccounts;

  throw new MetaAdsApiError(
    successfulDiscoveryCall && !discoveredCandidate
      ? 'no_ad_accounts'
      : 'ads_read_missing',
    400
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
