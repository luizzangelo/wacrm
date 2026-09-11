import { describe, expect, it, vi } from 'vitest';

import { encrypt } from '@/lib/whatsapp/encryption';

import type { MetaConversionsRepository } from './config';
import { validateStoredMetaConversionConfig } from './validate';

describe('stored Meta Conversions validation', () => {
  it('decrypts only server-side and returns no token or ciphertext', async () => {
    const accessCiphertext = encrypt('EA_TEST_TOKEN');
    const getConfig = vi.fn(async () => ({
      id: 'config-1',
      account_id: 'account-a',
      dataset_id: '123456789',
      access_token: accessCiphertext,
      marketing_access_token: null,
      enabled: false,
    }));
    const getWhatsApp = vi.fn(async () => ({
      waba_id: 'waba-1',
      phone_number_id: 'phone-1',
    }));
    const repository: MetaConversionsRepository = {
      getConfig,
      getWhatsApp,
      upsertConfig: vi.fn(),
    };
    const fetcher = vi.fn(
      async (
        _input: string | URL | Request,
        init?: RequestInit
      ): Promise<Response> => {
        expect(init?.headers).toEqual({
          Authorization: 'Bearer EA_TEST_TOKEN',
        });
        return Response.json({ id: '123456789', name: 'Dataset' });
      }
    );

    const result = await validateStoredMetaConversionConfig(
      repository,
      'account-a',
      fetcher
    );
    const wire = JSON.stringify(result);

    expect(result.valid).toBe(true);
    expect(getConfig).toHaveBeenCalledWith('account-a');
    expect(getWhatsApp).toHaveBeenCalledWith('account-a');
    expect(wire).not.toContain('EA_TEST_TOKEN');
    expect(wire).not.toContain(accessCiphertext);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
