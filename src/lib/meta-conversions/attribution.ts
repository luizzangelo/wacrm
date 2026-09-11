import type { SupabaseClient } from '@supabase/supabase-js';

import type { MetaAdAttribution } from '@/types';

export interface WhatsAppReferral {
  source_url?: string;
  source_id?: string;
  source_type?: string;
  headline?: string;
  body?: string;
  media_type?: string;
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  ctwa_clid?: string;
}

export interface WhatsAppConfigAttributionSnapshot {
  id: string;
  waba_id: string | null;
  phone_number_id: string;
}

export interface CaptureMetaAdAttributionInput {
  accountId: string;
  contactId: string;
  conversationId: string;
  whatsappConfig: WhatsAppConfigAttributionSnapshot;
  whatsappMessageId: string;
  whatsappMessageTimestamp?: string;
  referral?: WhatsAppReferral;
  now?: () => Date;
}

type MetaAdAttributionInsert = Pick<
  MetaAdAttribution,
  | 'account_id'
  | 'contact_id'
  | 'conversation_id'
  | 'whatsapp_config_id'
  | 'whatsapp_message_id'
  | 'ctwa_clid'
  | 'source_id'
  | 'source_type'
  | 'source_url'
  | 'referral_headline'
  | 'referral_body'
  | 'media_type'
  | 'image_url'
  | 'video_url'
  | 'thumbnail_url'
  | 'waba_id'
  | 'phone_number_id'
  | 'ad_id'
  | 'enrichment_status'
  | 'received_at'
>;

export type CaptureMetaAdAttributionResult =
  { captured: false; reason: 'not_ctwa' } | { captured: true };

export class MetaAttributionPersistenceError extends Error {
  constructor(readonly code: string) {
    super('Failed to persist Meta ad attribution');
    this.name = 'MetaAttributionPersistenceError';
  }
}

export function isCtwaReferral(
  referral: WhatsAppReferral | undefined
): referral is WhatsAppReferral & { source_type: 'ad'; ctwa_clid: string } {
  return (
    referral?.source_type === 'ad' &&
    typeof referral.ctwa_clid === 'string' &&
    referral.ctwa_clid.trim().length > 0
  );
}

export function whatsappTimestampToIso(
  timestamp: string | undefined,
  now: () => Date = () => new Date()
): string {
  if (timestamp && /^\d+$/.test(timestamp)) {
    const milliseconds = Number(timestamp) * 1000;
    if (Number.isSafeInteger(milliseconds)) {
      const date = new Date(milliseconds);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }

  return now().toISOString();
}

export function buildMetaAdAttributionPayload(
  input: CaptureMetaAdAttributionInput
): MetaAdAttributionInsert | null {
  const referral = input.referral;
  if (!isCtwaReferral(referral)) return null;

  return {
    account_id: input.accountId,
    contact_id: input.contactId,
    conversation_id: input.conversationId,
    whatsapp_config_id: input.whatsappConfig.id,
    whatsapp_message_id: input.whatsappMessageId,
    // Preserve Meta identifiers byte-for-byte. The trim above is only an
    // emptiness check; the value written here is the original string.
    ctwa_clid: referral.ctwa_clid,
    source_id: referral.source_id ?? null,
    source_type: referral.source_type,
    source_url: referral.source_url ?? null,
    referral_headline: referral.headline ?? null,
    referral_body: referral.body ?? null,
    media_type: referral.media_type ?? null,
    image_url: referral.image_url ?? null,
    video_url: referral.video_url ?? null,
    thumbnail_url: referral.thumbnail_url ?? null,
    waba_id: input.whatsappConfig.waba_id,
    phone_number_id: input.whatsappConfig.phone_number_id,
    // Meta's current CTWA webhook reference explicitly labels source_id as
    // AD_ID when source_type is "ad". No Ads API lookup is needed here.
    ad_id: referral.source_id ?? null,
    enrichment_status: 'pending',
    received_at: whatsappTimestampToIso(
      input.whatsappMessageTimestamp,
      input.now
    ),
  };
}

function databaseErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : 'unknown';
}

/**
 * Insert-once capture. The database's UNIQUE(account_id, ctwa_clid) is the
 * final concurrency boundary. A duplicate is deliberately left untouched,
 * so a partial replay can never replace previously captured values with null.
 */
export async function captureMetaAdAttribution(
  db: SupabaseClient,
  input: CaptureMetaAdAttributionInput
): Promise<CaptureMetaAdAttributionResult> {
  const payload = buildMetaAdAttributionPayload(input);
  if (!payload) return { captured: false, reason: 'not_ctwa' };

  const { error } = await db.from('meta_ad_attributions').upsert(payload, {
    onConflict: 'account_id,ctwa_clid',
    ignoreDuplicates: true,
  });

  if (error) {
    throw new MetaAttributionPersistenceError(databaseErrorCode(error));
  }

  return { captured: true };
}

export function maskCtwaClid(value: string): string {
  if (value.length <= 6) return '***';
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}
