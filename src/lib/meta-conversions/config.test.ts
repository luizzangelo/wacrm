import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decrypt } from '@/lib/whatsapp/encryption';

import {
  getSafeMetaConversionConfig,
  MetaConversionsConfigError,
  parseMetaConversionConfigPatch,
  saveMetaConversionConfig,
  type MetaConversionsRepository,
  type StoredMetaConversionConfig,
  type StoredWhatsAppConfig,
} from './config';

const ACCOUNT_A = 'account-a';

class MemoryRepository implements MetaConversionsRepository {
  config: StoredMetaConversionConfig | null = null;
  whatsapp: StoredWhatsAppConfig | null = {
    waba_id: 'waba-1',
    phone_number_id: 'phone-number-id-1',
  };
  writes: Array<{
    accountId: string;
    patch: Record<string, string | boolean | null>;
  }> = [];
  reads: Array<{ table: 'config' | 'whatsapp'; accountId: string }> = [];

  async getConfig(accountId: string) {
    this.reads.push({ table: 'config', accountId });
    return this.config?.account_id === accountId ? this.config : null;
  }

  async getWhatsApp(accountId: string) {
    this.reads.push({ table: 'whatsapp', accountId });
    return accountId === ACCOUNT_A ? this.whatsapp : null;
  }

  async upsertConfig(
    accountId: string,
    patch: Record<string, string | boolean | null>
  ) {
    this.writes.push({ accountId, patch });
    this.config = {
      id: this.config?.id ?? 'config-1',
      account_id: accountId,
      dataset_id: this.config?.dataset_id ?? null,
      access_token: this.config?.access_token ?? null,
      marketing_access_token: this.config?.marketing_access_token ?? null,
      enabled: this.config?.enabled ?? false,
      ...patch,
    };
  }
}

function storedConfig(
  overrides: Partial<StoredMetaConversionConfig> = {}
): StoredMetaConversionConfig {
  return {
    id: 'config-1',
    account_id: ACCOUNT_A,
    dataset_id: 'dataset-1',
    access_token: 'cipher-access',
    marketing_access_token: 'cipher-marketing',
    enabled: false,
    ...overrides,
  };
}

let repository: MemoryRepository;

beforeEach(() => {
  repository = new MemoryRepository();
});

describe('Meta Conversions configuration', () => {
  it('returns only safe flags and account-local WhatsApp identifiers', async () => {
    repository.config = storedConfig();

    const safe = await getSafeMetaConversionConfig(repository, ACCOUNT_A);
    const wire = JSON.stringify(safe);

    expect(safe).toEqual({
      configured: true,
      enabled: false,
      dataset_id: 'dataset-1',
      has_access_token: true,
      has_marketing_access_token: true,
      whatsapp: {
        configured: true,
        waba_id: 'waba-1',
        phone_number_id: 'phone-number-id-1',
      },
    });
    expect(safe).not.toHaveProperty('access_token');
    expect(safe).not.toHaveProperty('marketing_access_token');
    expect(wire).not.toContain('cipher-access');
    expect(wire).not.toContain('cipher-marketing');
  });

  it('does not expose another workspace configuration', async () => {
    repository.config = storedConfig();

    const safe = await getSafeMetaConversionConfig(repository, 'account-b');

    expect(safe.configured).toBe(false);
    expect(safe.has_access_token).toBe(false);
    expect(repository.reads).toEqual([
      { table: 'config', accountId: 'account-b' },
      { table: 'whatsapp', accountId: 'account-b' },
    ]);
  });

  it('encrypts a new primary token and never persists plaintext', async () => {
    repository.config = storedConfig({ access_token: null });
    const encryptSecret = vi.fn(() => 'encrypted-primary');

    await saveMetaConversionConfig(
      repository,
      ACCOUNT_A,
      { access_token: 'EA_TEST_TOKEN' },
      encryptSecret
    );

    expect(encryptSecret).toHaveBeenCalledWith('EA_TEST_TOKEN');
    expect(repository.writes[0].patch.access_token).toBe('encrypted-primary');
    expect(JSON.stringify(repository.writes)).not.toContain('EA_TEST_TOKEN');
  });

  it('uses the existing AES-256-GCM helper end to end', async () => {
    repository.config = storedConfig({ access_token: null });

    await saveMetaConversionConfig(repository, ACCOUNT_A, {
      access_token: 'EA_TEST_TOKEN',
    });

    const ciphertext = repository.writes[0].patch.access_token as string;
    expect(ciphertext).not.toContain('EA_TEST_TOKEN');
    expect(ciphertext.split(':')).toHaveLength(3);
    expect(decrypt(ciphertext)).toBe('EA_TEST_TOKEN');
  });

  it('preserves stored tokens when token fields are omitted or empty', async () => {
    repository.config = storedConfig();
    const patch = parseMetaConversionConfigPatch({
      dataset_id: 'dataset-2',
      access_token: '',
      marketing_access_token: '   ',
    });

    await saveMetaConversionConfig(repository, ACCOUNT_A, patch);

    expect(repository.writes[0].patch).toEqual({ dataset_id: 'dataset-2' });
    expect(repository.config?.access_token).toBe('cipher-access');
    expect(repository.config?.marketing_access_token).toBe('cipher-marketing');
  });

  it('encrypts a replacement Marketing API token', async () => {
    repository.config = storedConfig({ marketing_access_token: null });
    const encryptSecret = vi.fn(() => 'encrypted-marketing');

    await saveMetaConversionConfig(
      repository,
      ACCOUNT_A,
      { marketing_access_token: 'MARKETING_TEST_TOKEN' },
      encryptSecret
    );

    expect(encryptSecret).toHaveBeenCalledWith('MARKETING_TEST_TOKEN');
    expect(repository.writes[0].patch.marketing_access_token).toBe(
      'encrypted-marketing'
    );
  });

  it('clears the Marketing API token only through the explicit action', async () => {
    repository.config = storedConfig();

    await saveMetaConversionConfig(repository, ACCOUNT_A, {
      clear_marketing_access_token: true,
    });

    expect(repository.writes[0].patch).toEqual({
      marketing_access_token: null,
    });
    expect(repository.config?.marketing_access_token).toBeNull();
  });

  it.each([
    {
      name: 'Dataset / Pixel ID',
      config: storedConfig({ dataset_id: null }),
      whatsapp: { waba_id: 'waba-1', phone_number_id: 'phone-1' },
    },
    {
      name: 'Access Token',
      config: storedConfig({ access_token: null }),
      whatsapp: { waba_id: 'waba-1', phone_number_id: 'phone-1' },
    },
    {
      name: 'WABA ID',
      config: storedConfig(),
      whatsapp: { waba_id: null, phone_number_id: 'phone-1' },
    },
  ])(
    'rejects enabled=true without $name',
    async ({ name, config, whatsapp }) => {
      repository.config = config;
      repository.whatsapp = whatsapp;

      await expect(
        saveMetaConversionConfig(repository, ACCOUNT_A, { enabled: true })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining(name),
      } satisfies Partial<MetaConversionsConfigError>);
      expect(repository.writes).toHaveLength(0);
    }
  );
});
