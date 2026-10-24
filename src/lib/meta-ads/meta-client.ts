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
  error: {
    code: number | null;
    error_subcode: number | null;
    message: string;
  } | null;
}

export interface MetaAdsDiscoveryResult {
  accounts: MetaAdAccountChoice[];
  tokenType: string | null;
  scopes: string[];
  granularScopes: DebugScope[];
  expiresAt: string | null;
  dataAccessExpiresAt: string | null;
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
  endpoint: string,
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
    console.info(
      '[meta-ads/graph-call]',
      JSON.stringify({
        endpoint,
        http_status: response.status,
        data_count: null,
        error: {
          code: numberValue(error?.code) ?? null,
          error_subcode: numberValue(error?.error_subcode) ?? null,
          message:
            typeof error?.message === 'string'
              ? error.message
              : 'invalid_meta_response',
        },
      })
    );
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
    return { ok: false, status: null, payload: null, error: logEntry.error };
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
    error,
  };
}

function timestampIso(value: unknown): string | null {
  const seconds = numberValue(value);
  if (!seconds || seconds <= 0) return null;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
  let payload: Record<string, unknown>;
  try {
    payload = await graphJson(
      '/oauth/access_token',
      url,
      { method: 'GET' },
      fetcher
    );
  } catch (error) {
    if (error instanceof MetaAdsApiError) {
      throw new MetaAdsApiError(
        'code_exchange_failed',
        error.status,
        error.metaCode,
        error.metaSubcode
      );
    }
    throw error;
  }
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
): Promise<MetaAdsDiscoveryResult> {
  const debugUrl = new URL(
    `https://graph.facebook.com/${config.graphVersion}/debug_token`
  );
  debugUrl.searchParams.set('input_token', token);
  debugUrl.searchParams.set(
    'access_token',
    `${config.appId}|${config.appSecret}`
  );
  let debug: Record<string, unknown>;
  try {
    debug = await graphJson(
      '/debug_token',
      debugUrl,
      { method: 'GET' },
      fetcher
    );
  } catch (error) {
    if (error instanceof MetaAdsApiError) {
      throw new MetaAdsApiError(
        'token_validation_failed',
        error.status,
        error.metaCode,
        error.metaSubcode
      );
    }
    throw error;
  }
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
  const metadata = {
    tokenType: debugLog.type,
    scopes,
    granularScopes,
    expiresAt: timestampIso(data.expires_at),
    dataAccessExpiresAt: timestampIso(data.data_access_expires_at),
  };
  const adsReadDeclared =
    scopes.includes('ads_read') ||
    granularScopes.some(({ scope }) => scope === 'ads_read');
  let successfulDiscoveryCall = false;
  let discoveredCandidate = false;
  let unsupportedTokenType = false;
  let emptyBusinesses = false;
  let proofAttempted = false;
  let listingFailed = false;

  async function acceptRoute(
    route: 'me_adaccounts' | 'business_accounts',
    candidateIds: string[]
  ) {
    if (!candidateIds.length) return null;
    discoveredCandidate = true;
    proofAttempted = true;
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
    if (directAccounts) return { accounts: directAccounts, ...metadata };
  }
  unsupportedTokenType ||= directResult.error?.code === 100;
  listingFailed ||=
    !directResult.ok && ![10, 100, 200].includes(directResult.error?.code ?? 0);

  const granularAdAccounts = await acceptRoute(
    'me_adaccounts',
    granularScopes.find(({ scope }) => scope === 'ads_read')?.targetIds ?? []
  );
  if (granularAdAccounts) return { accounts: granularAdAccounts, ...metadata };

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
        emptyBusinesses = businessIds.length === 0;
      } else {
        listingFailed = true;
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
  if (businessAccounts) return { accounts: businessAccounts, ...metadata };

  throw new MetaAdsApiError(
    proofAttempted
      ? 'ad_account_proof_failed'
      : unsupportedTokenType || emptyBusinesses
        ? 'unsupported_token_type'
        : listingFailed
          ? 'ad_account_listing_failed'
          : adsReadDeclared || (successfulDiscoveryCall && !discoveredCandidate)
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
    '/me/permissions',
    url,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    fetcher
  );
}
