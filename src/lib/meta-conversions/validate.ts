import { decrypt } from '@/lib/whatsapp/encryption';

import type { MetaConversionsRepository } from './config';
import { MetaConversionsConfigError } from './config';
import {
  validateMetaCredentials,
  type MetaConfigurationValidation,
} from './meta-client';

export async function validateStoredMetaConversionConfig(
  repository: MetaConversionsRepository,
  accountId: string,
  fetcher: typeof fetch = fetch
): Promise<MetaConfigurationValidation> {
  const [config, whatsapp] = await Promise.all([
    repository.getConfig(accountId),
    repository.getWhatsApp(accountId),
  ]);

  if (!config?.dataset_id || !config.access_token) {
    throw new MetaConversionsConfigError('Configuração incompleta', 400);
  }
  const wabaId = whatsapp?.waba_id?.trim();
  if (!wabaId) {
    throw new MetaConversionsConfigError('WhatsApp não configurado', 400);
  }

  let accessToken: string;
  let marketingAccessToken: string | null = null;
  try {
    accessToken = decrypt(config.access_token);
    if (config.marketing_access_token) {
      marketingAccessToken = decrypt(config.marketing_access_token);
    }
  } catch {
    throw new MetaConversionsConfigError(
      'Não foi possível ler as credenciais salvas',
      500
    );
  }

  return validateMetaCredentials(
    {
      datasetId: config.dataset_id,
      accessToken,
      marketingAccessToken,
      wabaId,
    },
    fetcher
  );
}
