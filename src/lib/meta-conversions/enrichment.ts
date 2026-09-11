import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';

import { META_ATTRIBUTION_ENRICHMENT_BATCH_SIZE } from './constants';
import {
  MetaMarketingApiError,
  readMetaAdHierarchy,
  type MetaAdHierarchy,
  type MetaMarketingErrorDetails,
} from './marketing-api';

export interface StoredMetaAttributionForEnrichment {
  id: string;
  account_id: string;
  ad_id: string | null;
  source_id: string | null;
  ad_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  enrichment_status: 'pending' | 'enriched' | 'failed';
  received_at: string;
}

export interface StoredMetaEnrichmentConfig {
  account_id: string;
  access_token: string | null;
  marketing_access_token: string | null;
  enabled: boolean;
}

export interface MetaEnrichmentCandidate {
  id: string;
  account_id: string;
}

export interface MetaEnrichmentRepository {
  getAttribution(
    accountId: string,
    attributionId: string
  ): Promise<StoredMetaAttributionForEnrichment | null>;
  getConfig(accountId: string): Promise<StoredMetaEnrichmentConfig | null>;
  markEnriched(
    accountId: string,
    attributionId: string,
    hierarchy: MetaAdHierarchy,
    enrichedAt: string
  ): Promise<void>;
  markFailed(
    accountId: string,
    attributionId: string,
    error: string
  ): Promise<void>;
  listCandidates(limit: number): Promise<MetaEnrichmentCandidate[]>;
}

export type MetaEnrichmentResult =
  | { status: 'enriched' }
  | {
      status: 'pending';
      reason: 'missing_credentials' | 'unreadable_credentials';
    }
  | { status: 'failed'; error: MetaMarketingErrorDetails }
  | { status: 'already_enriched' }
  | { status: 'not_found' };

export interface MetaEnrichmentBatchResult {
  scanned: number;
  enriched: number;
  pending: number;
  failed: number;
  already_enriched: number;
  not_found: number;
  errors: number;
}

class MetaEnrichmentPersistenceError extends Error {
  constructor(
    readonly operation: string,
    readonly code: string
  ) {
    super('Meta attribution enrichment persistence failed');
    this.name = 'MetaEnrichmentPersistenceError';
  }
}

function databaseErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code).slice(0, 64)
    : 'unknown';
}

function assertDatabaseResult(
  operation: string,
  error: unknown,
  updatedRow?: unknown
): void {
  if (error) {
    throw new MetaEnrichmentPersistenceError(
      operation,
      databaseErrorCode(error)
    );
  }
  if (updatedRow === null) {
    throw new MetaEnrichmentPersistenceError(operation, 'row_not_found');
  }
}

export function createMetaEnrichmentRepository(
  db: SupabaseClient
): MetaEnrichmentRepository {
  return {
    async getAttribution(accountId, attributionId) {
      const { data, error } = await db
        .from('meta_ad_attributions')
        .select(
          'id,account_id,ad_id,source_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,enrichment_status,received_at'
        )
        .eq('id', attributionId)
        .eq('account_id', accountId)
        .maybeSingle();
      assertDatabaseResult('get_attribution', error);
      return data as StoredMetaAttributionForEnrichment | null;
    },

    async getConfig(accountId) {
      const { data, error } = await db
        .from('meta_conversion_config')
        .select('account_id,access_token,marketing_access_token,enabled')
        .eq('account_id', accountId)
        .maybeSingle();
      assertDatabaseResult('get_config', error);
      return data as StoredMetaEnrichmentConfig | null;
    },

    async markEnriched(accountId, attributionId, hierarchy, enrichedAt) {
      const { data, error } = await db
        .from('meta_ad_attributions')
        .update({
          ...hierarchy,
          enrichment_status: 'enriched',
          enrichment_error: null,
          enriched_at: enrichedAt,
        })
        .eq('id', attributionId)
        .eq('account_id', accountId)
        .select('id')
        .maybeSingle();
      assertDatabaseResult('mark_enriched', error, data);
    },

    async markFailed(accountId, attributionId, errorMessage) {
      const { data, error } = await db
        .from('meta_ad_attributions')
        .update({
          enrichment_status: 'failed',
          enrichment_error: errorMessage,
          enriched_at: null,
        })
        .eq('id', attributionId)
        .eq('account_id', accountId)
        .select('id')
        .maybeSingle();
      assertDatabaseResult('mark_failed', error, data);
    },

    async listCandidates(limit) {
      const safeLimit = Math.max(1, Math.min(limit, 50));
      const { data, error } = await db
        .from('meta_ad_attributions')
        .select('id,account_id')
        .in('enrichment_status', ['pending', 'failed'])
        .order('received_at', { ascending: true })
        .limit(safeLimit);
      assertDatabaseResult('list_candidates', error);
      return (data ?? []) as MetaEnrichmentCandidate[];
    },
  };
}

function hasCompleteHierarchy(
  attribution: StoredMetaAttributionForEnrichment
): boolean {
  return Boolean(
    attribution.ad_id &&
    attribution.ad_name &&
    attribution.adset_id &&
    attribution.adset_name &&
    attribution.campaign_id &&
    attribution.campaign_name
  );
}

function compactError(details: MetaMarketingErrorDetails): string {
  return JSON.stringify(details).slice(0, 2_000);
}

function safeFailureDetails(error: unknown): MetaMarketingErrorDetails {
  if (error instanceof MetaMarketingApiError) return error.details;
  return {
    kind: 'invalid_response',
    message: 'Unexpected Marketing API client failure',
  };
}

function logFailure(
  accountId: string,
  attributionId: string,
  adId: string,
  details: MetaMarketingErrorDetails
): void {
  console.error('[meta-conversions][enrichment]', {
    account_id: accountId,
    attribution_id: attributionId,
    ad_id: adId,
    status: 'failed',
    http_status: details.http_status,
    meta_error_code: details.code,
    meta_error_subcode: details.subcode,
  });
}

export async function enrichMetaAdAttribution(options: {
  repository: MetaEnrichmentRepository;
  accountId: string;
  attributionId: string;
  decryptToken?: (ciphertext: string) => string;
  readHierarchy?: (
    adId: string,
    accessToken: string
  ) => Promise<MetaAdHierarchy>;
  now?: () => Date;
}): Promise<MetaEnrichmentResult> {
  const {
    repository,
    accountId,
    attributionId,
    decryptToken = decrypt,
    readHierarchy = readMetaAdHierarchy,
    now = () => new Date(),
  } = options;

  const attribution = await repository.getAttribution(accountId, attributionId);
  if (!attribution) return { status: 'not_found' };

  if (
    attribution.enrichment_status === 'enriched' &&
    hasCompleteHierarchy(attribution)
  ) {
    return { status: 'already_enriched' };
  }

  const adId = attribution.ad_id || attribution.source_id;
  if (!adId) {
    const details: MetaMarketingErrorDetails = {
      kind: 'invalid_attribution',
      message: 'Attribution has no ad identifier',
    };
    await repository.markFailed(
      accountId,
      attributionId,
      compactError(details)
    );
    logFailure(accountId, attributionId, 'missing', details);
    return { status: 'failed', error: details };
  }

  const config = await repository.getConfig(accountId);
  const encryptedToken =
    config?.marketing_access_token || config?.access_token || null;
  if (!encryptedToken) {
    return { status: 'pending', reason: 'missing_credentials' };
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(encryptedToken);
  } catch {
    return { status: 'pending', reason: 'unreadable_credentials' };
  }
  if (!accessToken.trim()) {
    return { status: 'pending', reason: 'unreadable_credentials' };
  }

  let hierarchy: MetaAdHierarchy;
  try {
    hierarchy = await readHierarchy(adId, accessToken);
  } catch (error) {
    const details = safeFailureDetails(error);
    await repository.markFailed(
      accountId,
      attributionId,
      compactError(details)
    );
    logFailure(accountId, attributionId, adId, details);
    return { status: 'failed', error: details };
  }

  await repository.markEnriched(
    accountId,
    attributionId,
    hierarchy,
    now().toISOString()
  );
  return { status: 'enriched' };
}

export async function processMetaAdEnrichmentBatch(options: {
  repository: MetaEnrichmentRepository;
  batchSize?: number;
  enrichOne?: (
    candidate: MetaEnrichmentCandidate
  ) => Promise<MetaEnrichmentResult>;
}): Promise<MetaEnrichmentBatchResult> {
  const { repository, batchSize = META_ATTRIBUTION_ENRICHMENT_BATCH_SIZE } =
    options;
  const candidates = await repository.listCandidates(batchSize);
  const summary: MetaEnrichmentBatchResult = {
    scanned: candidates.length,
    enriched: 0,
    pending: 0,
    failed: 0,
    already_enriched: 0,
    not_found: 0,
    errors: 0,
  };

  for (const candidate of candidates) {
    try {
      const result = options.enrichOne
        ? await options.enrichOne(candidate)
        : await enrichMetaAdAttribution({
            repository,
            accountId: candidate.account_id,
            attributionId: candidate.id,
          });
      summary[result.status]++;
    } catch (error) {
      summary.errors++;
      console.error('[meta-conversions][enrichment] batch item failed', {
        account_id: candidate.account_id,
        attribution_id: candidate.id,
        status: 'failed',
        error_code:
          error && typeof error === 'object' && 'code' in error
            ? String(error.code).slice(0, 64)
            : 'unknown',
      });
    }
  }

  return summary;
}
