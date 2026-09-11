import type { SupabaseClient } from '@supabase/supabase-js';

import type { MetaAdAttribution } from '@/types';

export type MetaAdAttributionView = Pick<
  MetaAdAttribution,
  | 'id'
  | 'account_id'
  | 'contact_id'
  | 'ad_id'
  | 'ad_name'
  | 'adset_id'
  | 'adset_name'
  | 'campaign_id'
  | 'campaign_name'
  | 'enrichment_status'
  | 'received_at'
>;

export type DealMetaAttributionSelection =
  | {
      attribution: MetaAdAttributionView;
      source: 'deal_fixed' | 'contact_preview';
    }
  | { attribution: null; source: null };

const VIEW_FIELDS =
  'id,account_id,contact_id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,enrichment_status,received_at';

export class MetaAttributionViewReadError extends Error {
  constructor(readonly code: string) {
    super('Failed to read Meta ad attribution');
    this.name = 'MetaAttributionViewReadError';
  }
}

function databaseErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code).slice(0, 64)
    : 'unknown';
}

export async function getLatestContactMetaAttribution(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<MetaAdAttributionView | null> {
  const { data, error } = await db
    .from('meta_ad_attributions')
    .select(VIEW_FIELDS)
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new MetaAttributionViewReadError(databaseErrorCode(error));
  }
  return data as MetaAdAttributionView | null;
}

export async function getDealMetaAttribution(
  db: SupabaseClient,
  options: {
    accountId: string;
    metaAttributionId: string | null;
    contactId: string | null;
  }
): Promise<DealMetaAttributionSelection> {
  if (options.metaAttributionId) {
    const { data, error } = await db
      .from('meta_ad_attributions')
      .select(VIEW_FIELDS)
      .eq('account_id', options.accountId)
      .eq('id', options.metaAttributionId)
      .maybeSingle();

    if (error) {
      throw new MetaAttributionViewReadError(databaseErrorCode(error));
    }
    return data
      ? {
          attribution: data as MetaAdAttributionView,
          source: 'deal_fixed',
        }
      : { attribution: null, source: null };
  }

  if (!options.contactId) return { attribution: null, source: null };

  const attribution = await getLatestContactMetaAttribution(
    db,
    options.accountId,
    options.contactId
  );
  return attribution
    ? { attribution, source: 'contact_preview' }
    : { attribution: null, source: null };
}
