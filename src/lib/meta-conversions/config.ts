import { operationalErrorFields } from '@/lib/security/operational-log';
import type { SupabaseClient } from '@supabase/supabase-js';

import { encrypt } from '@/lib/whatsapp/encryption';

export interface StoredMetaConversionConfig {
  id: string;
  account_id: string;
  dataset_id: string | null;
  access_token: string | null;
  marketing_access_token: string | null;
  enabled: boolean;
}

export interface StoredWhatsAppConfig {
  waba_id: string | null;
  phone_number_id: string;
}

export interface SafeMetaConversionConfig {
  configured: boolean;
  enabled: boolean;
  dataset_id: string | null;
  has_access_token: boolean;
  has_marketing_access_token: boolean;
  whatsapp: {
    configured: boolean;
    waba_id: string | null;
    phone_number_id: string | null;
  };
}

export interface MetaConversionConfigPatch {
  dataset_id?: string | null;
  access_token?: string;
  marketing_access_token?: string;
  clear_marketing_access_token?: boolean;
  enabled?: boolean;
}

export interface MetaConversionsRepository {
  getConfig(accountId: string): Promise<StoredMetaConversionConfig | null>;
  getWhatsApp(accountId: string): Promise<StoredWhatsAppConfig | null>;
  upsertConfig(
    accountId: string,
    patch: Record<string, string | boolean | null>
  ): Promise<void>;
}

export class MetaConversionsConfigError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'MetaConversionsConfigError';
  }
}

function databaseError(operation: string, error: unknown): never {
  const code = operationalErrorFields(error).error_code ?? 'unknown';
  console.error(`[meta-conversions] ${operation} failed`, { code });
  throw new MetaConversionsConfigError('Falha ao acessar a configuração', 500);
}

/**
 * Service-role repository. Every read includes an explicit account_id filter;
 * writes receive account_id from the authenticated server context, never from
 * browser input.
 */
export function createMetaConversionsRepository(
  db: SupabaseClient
): MetaConversionsRepository {
  return {
    async getConfig(accountId) {
      const { data, error } = await db
        .from('meta_conversion_config')
        .select(
          'id, account_id, dataset_id, access_token, marketing_access_token, enabled'
        )
        .eq('account_id', accountId)
        .maybeSingle();

      if (error) databaseError('config read', error);
      return data as StoredMetaConversionConfig | null;
    },

    async getWhatsApp(accountId) {
      const { data, error } = await db
        .from('whatsapp_config')
        .select('waba_id, phone_number_id')
        .eq('account_id', accountId)
        .maybeSingle();

      if (error) databaseError('WhatsApp config read', error);
      return data as StoredWhatsAppConfig | null;
    },

    async upsertConfig(accountId, patch) {
      const { error } = await db.from('meta_conversion_config').upsert(
        {
          account_id: accountId,
          ...patch,
        },
        { onConflict: 'account_id' }
      );

      if (error) databaseError('config write', error);
    },
  };
}

export function toSafeConfig(
  config: StoredMetaConversionConfig | null,
  whatsapp: StoredWhatsAppConfig | null
): SafeMetaConversionConfig {
  const wabaId = whatsapp?.waba_id?.trim() || null;
  const phoneNumberId = whatsapp?.phone_number_id?.trim() || null;

  return {
    configured: config !== null,
    enabled: config?.enabled ?? false,
    dataset_id: config?.dataset_id ?? null,
    has_access_token: Boolean(config?.access_token),
    has_marketing_access_token: Boolean(config?.marketing_access_token),
    whatsapp: {
      configured: Boolean(wabaId && phoneNumberId),
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
    },
  };
}

export async function getSafeMetaConversionConfig(
  repository: MetaConversionsRepository,
  accountId: string
): Promise<SafeMetaConversionConfig> {
  const [config, whatsapp] = await Promise.all([
    repository.getConfig(accountId),
    repository.getWhatsApp(accountId),
  ]);
  return toSafeConfig(config, whatsapp);
}

export function parseMetaConversionConfigPatch(
  body: unknown
): MetaConversionConfigPatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new MetaConversionsConfigError('Corpo da requisição inválido', 400);
  }

  const input = body as Record<string, unknown>;
  const patch: MetaConversionConfigPatch = {};

  if ('dataset_id' in input) {
    if (input.dataset_id !== null && typeof input.dataset_id !== 'string') {
      throw new MetaConversionsConfigError('Dataset / Pixel ID inválido', 400);
    }
    const datasetId = input.dataset_id?.trim() || null;
    if (datasetId && datasetId.length > 128) {
      throw new MetaConversionsConfigError('Dataset / Pixel ID inválido', 400);
    }
    patch.dataset_id = datasetId;
  }

  for (const field of ['access_token', 'marketing_access_token'] as const) {
    if (field in input) {
      if (typeof input[field] !== 'string') {
        throw new MetaConversionsConfigError('Token inválido', 400);
      }
      // Empty means preserve the stored credential, so omit it entirely.
      const token = input[field].trim();
      if (token) patch[field] = token;
    }
  }

  if ('clear_marketing_access_token' in input) {
    if (typeof input.clear_marketing_access_token !== 'boolean') {
      throw new MetaConversionsConfigError('Ação de remoção inválida', 400);
    }
    patch.clear_marketing_access_token = input.clear_marketing_access_token;
  }

  if (
    patch.clear_marketing_access_token &&
    patch.marketing_access_token !== undefined
  ) {
    throw new MetaConversionsConfigError(
      'Não é possível substituir e remover o Marketing Token ao mesmo tempo',
      400
    );
  }

  if ('enabled' in input) {
    if (typeof input.enabled !== 'boolean') {
      throw new MetaConversionsConfigError('Status inválido', 400);
    }
    patch.enabled = input.enabled;
  }

  return patch;
}

export async function saveMetaConversionConfig(
  repository: MetaConversionsRepository,
  accountId: string,
  patch: MetaConversionConfigPatch,
  encryptSecret: (value: string) => string = encrypt
): Promise<SafeMetaConversionConfig> {
  const [existing, whatsapp] = await Promise.all([
    repository.getConfig(accountId),
    repository.getWhatsApp(accountId),
  ]);

  const finalEnabled = patch.enabled ?? existing?.enabled ?? false;
  const finalDatasetId =
    patch.dataset_id !== undefined
      ? patch.dataset_id
      : (existing?.dataset_id ?? null);
  const hasAccessToken = Boolean(patch.access_token || existing?.access_token);
  const hasWaba = Boolean(whatsapp?.waba_id?.trim());

  if (finalEnabled) {
    const missing: string[] = [];
    if (!finalDatasetId) missing.push('Dataset / Pixel ID');
    if (!hasAccessToken) missing.push('Access Token');
    if (!hasWaba) missing.push('WABA ID');
    if (missing.length) {
      throw new MetaConversionsConfigError(
        `Configuração incompleta: ${missing.join(', ')}`,
        400
      );
    }
  }

  const write: Record<string, string | boolean | null> = {};
  if (patch.dataset_id !== undefined) write.dataset_id = patch.dataset_id;
  if (patch.enabled !== undefined) write.enabled = patch.enabled;
  if (patch.access_token)
    write.access_token = encryptSecret(patch.access_token);
  if (patch.marketing_access_token) {
    write.marketing_access_token = encryptSecret(patch.marketing_access_token);
  } else if (patch.clear_marketing_access_token) {
    write.marketing_access_token = null;
  }

  await repository.upsertConfig(accountId, write);

  // Shape the response from known final state. No secret value or ciphertext
  // is ever copied into this object.
  return toSafeConfig(
    {
      id: existing?.id ?? '',
      account_id: accountId,
      dataset_id: finalDatasetId,
      access_token: patch.access_token
        ? '__configured__'
        : (existing?.access_token ?? null),
      marketing_access_token: patch.clear_marketing_access_token
        ? null
        : patch.marketing_access_token
          ? '__configured__'
          : (existing?.marketing_access_token ?? null),
      enabled: finalEnabled,
    },
    whatsapp
  );
}
