import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import { getMetaAdsServerConfig } from './config';
import {
  discoverMetaAdAccounts,
  exchangeMetaAdsCode,
  revokeMetaAdsToken,
  type MetaAdAccountChoice,
} from './meta-client';

export interface MetaAdsStoredConfig {
  marketing_access_token: string | null;
  marketing_token_source: 'manual' | 'facebook_login' | null;
  marketing_ad_account_id: string | null;
  marketing_ad_account_name: string | null;
  marketing_connected_at: string | null;
  marketing_ad_accounts: MetaAdAccountChoice[] | null;
  marketing_token_expires_at: string | null;
  marketing_data_access_expires_at: string | null;
  marketing_token_expired_at: string | null;
}

const FIELDS =
  'marketing_access_token,marketing_token_source,marketing_ad_account_id,marketing_ad_account_name,marketing_connected_at,marketing_ad_accounts,marketing_token_expires_at,marketing_data_access_expires_at,marketing_token_expired_at';

async function readConfig(
  db: SupabaseClient,
  accountId: string
): Promise<MetaAdsStoredConfig | null> {
  const { data, error } = await db
    .from('meta_conversion_config')
    .select(FIELDS)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw new Error('meta_ads_config_read_failed');
  return data as MetaAdsStoredConfig | null;
}

async function writeConfig(
  db: SupabaseClient,
  accountId: string,
  patch: Record<string, unknown>
) {
  const { error } = await db
    .from('meta_conversion_config')
    .upsert({ account_id: accountId, ...patch }, { onConflict: 'account_id' });
  if (error) throw new Error('meta_ads_config_write_failed');
}

export function safeMetaAdsStatus(config: MetaAdsStoredConfig | null) {
  const connected = Boolean(
    config?.marketing_access_token &&
    config.marketing_token_source === 'facebook_login' &&
    config.marketing_ad_account_id
  );
  const expirations = [
    config?.marketing_token_expires_at,
    config?.marketing_data_access_expires_at,
  ].filter((value): value is string => Boolean(value));
  const expiresAt = expirations.sort()[0] ?? null;
  const expired = Boolean(
    config?.marketing_token_expired_at ||
    (expiresAt && new Date(expiresAt).getTime() <= Date.now())
  );
  const needsReconnect = Boolean(
    expired ||
    (expiresAt &&
      new Date(expiresAt).getTime() - Date.now() <= 7 * 24 * 60 * 60 * 1_000)
  );
  return {
    connected,
    source: config?.marketing_token_source ?? null,
    adAccount: connected
      ? {
          id: `act_${config!.marketing_ad_account_id}`,
          name: config!.marketing_ad_account_name,
        }
      : null,
    connectedAt: connected ? config!.marketing_connected_at : null,
    expiresAt: connected ? expiresAt : null,
    expired: connected ? expired : false,
    needsReconnect: connected ? needsReconnect : false,
  };
}

export async function getMetaAdsStatus(db: SupabaseClient, accountId: string) {
  return safeMetaAdsStatus(await readConfig(db, accountId));
}

export async function connectMetaAds(
  db: SupabaseClient,
  accountId: string,
  input: { code?: string; adAccountId?: string }
) {
  const now = new Date().toISOString();
  if (input.code) {
    const serverConfig = getMetaAdsServerConfig();
    const token = await exchangeMetaAdsCode(serverConfig, input.code);
    const discovery = await discoverMetaAdAccounts(serverConfig, token);
    const accounts = discovery.accounts;
    const selected = accounts.length === 1 ? accounts[0] : null;
    await writeConfig(db, accountId, {
      marketing_access_token: encrypt(token),
      marketing_token_source: 'facebook_login',
      marketing_ad_accounts: accounts,
      marketing_ad_account_id: selected?.id ?? null,
      marketing_ad_account_name: selected?.name ?? null,
      marketing_connected_at: selected ? now : null,
      marketing_token_expires_at: discovery.expiresAt,
      marketing_data_access_expires_at: discovery.dataAccessExpiresAt,
      marketing_token_expired_at: null,
    });
    return selected
      ? safeMetaAdsStatus({
          marketing_access_token: '__configured__',
          marketing_token_source: 'facebook_login',
          marketing_ad_account_id: selected.id,
          marketing_ad_account_name: selected.name,
          marketing_connected_at: now,
          marketing_ad_accounts: accounts,
          marketing_token_expires_at: discovery.expiresAt,
          marketing_data_access_expires_at: discovery.dataAccessExpiresAt,
          marketing_token_expired_at: null,
        })
      : {
          connected: false,
          requiresSelection: true,
          adAccounts: accounts.map((a) => ({
            id: `act_${a.id}`,
            name: a.name,
          })),
        };
  }

  if (input.adAccountId) {
    const stored = await readConfig(db, accountId);
    const normalized = input.adAccountId.replace(/^act_/, '');
    const selected = stored?.marketing_ad_accounts?.find(
      (account) => account.id === normalized
    );
    if (
      !stored?.marketing_access_token ||
      stored.marketing_token_source !== 'facebook_login' ||
      !selected
    ) {
      throw new Error('invalid_ad_account_selection');
    }
    await writeConfig(db, accountId, {
      marketing_ad_account_id: selected.id,
      marketing_ad_account_name: selected.name,
      marketing_connected_at: now,
    });
    return safeMetaAdsStatus({
      ...stored,
      marketing_ad_account_id: selected.id,
      marketing_ad_account_name: selected.name,
      marketing_connected_at: now,
    });
  }
  throw new Error('invalid_connect_request');
}

export async function disconnectMetaAds(db: SupabaseClient, accountId: string) {
  const stored = await readConfig(db, accountId);
  if (
    stored?.marketing_access_token &&
    stored.marketing_token_source === 'facebook_login'
  ) {
    try {
      await revokeMetaAdsToken(
        getMetaAdsServerConfig(),
        decrypt(stored.marketing_access_token)
      );
    } catch (error) {
      console.warn('[meta-ads/disconnect] remote revoke failed', {
        error_code: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
  await writeConfig(db, accountId, {
    marketing_access_token: null,
    marketing_token_source: null,
    marketing_ad_account_id: null,
    marketing_ad_account_name: null,
    marketing_connected_at: null,
    marketing_ad_accounts: null,
    marketing_token_expires_at: null,
    marketing_data_access_expires_at: null,
    marketing_token_expired_at: null,
  });
}
