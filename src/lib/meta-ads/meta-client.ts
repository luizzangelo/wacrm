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
    try {
      const url = new URL(
        `https://graph.facebook.com/${config.graphVersion}/act_${id}`
      );
      url.searchParams.set('fields', 'name,account_id,account_status');
      const account = await graphJson(
        url,
        { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
        fetcher
      );
      accessibleAccounts.push({
        id: typeof account.account_id === 'string' ? account.account_id : id,
        name:
          typeof account.name === 'string' && account.name.trim()
            ? account.name.trim()
            : `act_${id}`,
        accountStatus: numberValue(account.account_status) ?? null,
      });
    } catch {
      // The practical account read is the final permission proof.
    }
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
  console.info('[meta-ads/debug-token]', {
    type: typeof data.type === 'string' ? data.type : null,
    scopes,
    granular_scopes: granularScopes.map(({ scope, targetIds }) => ({
      scope,
      target_ids: targetIds,
    })),
  });

  const granularAdsRead = granularScopes.find(
    (scope) => scope.scope === 'ads_read'
  );
  const scopesAdsRead = scopes.includes('ads_read');
  async function acceptRoute(
    route: 'granular_scopes' | 'scopes' | 'business_accounts',
    candidateIds: string[]
  ) {
    if (!candidateIds.length) return null;
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

  const granularAccounts = await acceptRoute(
    'granular_scopes',
    granularAdsRead?.targetIds ?? []
  );
  if (granularAccounts) return granularAccounts;

  if (scopesAdsRead) {
    try {
      const accountsUrl = new URL(
        `https://graph.facebook.com/${config.graphVersion}/me/adaccounts`
      );
      accountsUrl.searchParams.set('fields', 'name,account_id,account_status');
      accountsUrl.searchParams.set('limit', '100');
      const payload = await graphJson(
        accountsUrl,
        { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
        fetcher
      );
      const scopeAccounts = await acceptRoute(
        'scopes',
        uniqueIds(
          records(payload).flatMap((account) => [
            account.account_id,
            account.id,
          ])
        )
      );
      if (scopeAccounts) return scopeAccounts;
    } catch {
      // Continue to business discovery before rejecting the authorization.
    }
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
      const payload = await graphJson(
        businessesUrl,
        { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
        fetcher
      );
      businessIds = uniqueIds(records(payload).map((business) => business.id));
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
        const payload = await graphJson(
          url,
          { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
          fetcher
        );
        businessAccountIds.push(
          ...uniqueIds(
            records(payload).flatMap((account) => [
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
    granularAdsRead || scopesAdsRead ? 'no_ad_accounts' : 'ads_read_missing',
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
