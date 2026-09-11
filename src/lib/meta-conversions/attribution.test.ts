import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
  buildMetaAdAttributionPayload,
  captureMetaAdAttribution,
  MetaAttributionPersistenceError,
  type CaptureMetaAdAttributionInput,
} from './attribution';

type StoredAttribution = Record<string, unknown>;

function attributionDb(options?: { failureCode?: string }) {
  const rows: StoredAttribution[] = [];
  const tables: string[] = [];
  const upsert = vi.fn(
    async (
      payload: StoredAttribution,
      config: { onConflict?: string; ignoreDuplicates?: boolean }
    ) => {
      void config;
      if (options?.failureCode) {
        return {
          error: { code: options.failureCode, message: 'secret-token' },
        };
      }

      const existing = rows.find(
        (row) =>
          row.account_id === payload.account_id &&
          row.ctwa_clid === payload.ctwa_clid
      );
      if (!existing) rows.push(structuredClone(payload));

      return { error: null };
    }
  );
  const db = {
    from(table: string) {
      tables.push(table);
      return { upsert };
    },
  } as unknown as SupabaseClient;

  return { db, rows, tables, upsert };
}

const BASE_INPUT: CaptureMetaAdAttributionInput = {
  accountId: 'account-1',
  contactId: 'contact-1',
  conversationId: 'conversation-1',
  whatsappConfig: {
    id: 'whatsapp-config-1',
    waba_id: 'waba-1',
    phone_number_id: 'phone-number-1',
  },
  whatsappMessageId: 'wamid.CTWA1',
  whatsappMessageTimestamp: '1700000000',
};

const COMPLETE_REFERRAL = {
  source_url: 'https://fb.me/ad',
  source_id: 'ad-123',
  source_type: 'ad',
  headline: 'Apartamento Eusébio',
  body: 'Conheça o empreendimento',
  media_type: 'video',
  image_url: 'https://cdn.test/image.jpg',
  video_url: 'https://cdn.test/video.mp4',
  thumbnail_url: 'https://cdn.test/thumb.jpg',
  ctwa_clid: 'TEST_ctwa-AbC123_xyz',
};

describe('CTWA referral recognition', () => {
  it.each([
    ['no referral', undefined],
    [
      'non-ad referral',
      { source_type: 'post', ctwa_clid: 'TEST_ctwa-AbC123_xyz' },
    ],
    ['ad referral without ctwa_clid', { source_type: 'ad' }],
  ])('does not capture %s', async (_label, referral) => {
    const { db, rows, upsert } = attributionDb();

    const result = await captureMetaAdAttribution(db, {
      ...BASE_INPUT,
      referral,
    });

    expect(result).toEqual({ captured: false, reason: 'not_ctwa' });
    expect(rows).toHaveLength(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('captures source_type=ad with a non-empty ctwa_clid', async () => {
    const { db, rows } = attributionDb();

    await expect(
      captureMetaAdAttribution(db, {
        ...BASE_INPUT,
        referral: COMPLETE_REFERRAL,
      })
    ).resolves.toEqual({ captured: true });

    expect(rows).toHaveLength(1);
  });
});

describe('CTWA attribution payload', () => {
  it('persists every webhook field, receiver snapshot, and exact identifiers', () => {
    const payload = buildMetaAdAttributionPayload({
      ...BASE_INPUT,
      referral: COMPLETE_REFERRAL,
    });

    expect(payload).toEqual({
      account_id: 'account-1',
      contact_id: 'contact-1',
      conversation_id: 'conversation-1',
      whatsapp_config_id: 'whatsapp-config-1',
      whatsapp_message_id: 'wamid.CTWA1',
      ctwa_clid: 'TEST_ctwa-AbC123_xyz',
      source_id: 'ad-123',
      source_type: 'ad',
      source_url: 'https://fb.me/ad',
      referral_headline: 'Apartamento Eusébio',
      referral_body: 'Conheça o empreendimento',
      media_type: 'video',
      image_url: 'https://cdn.test/image.jpg',
      video_url: 'https://cdn.test/video.mp4',
      thumbnail_url: 'https://cdn.test/thumb.jpg',
      waba_id: 'waba-1',
      phone_number_id: 'phone-number-1',
      ad_id: 'ad-123',
      enrichment_status: 'pending',
      received_at: '2023-11-14T22:13:20.000Z',
    });
  });

  it('uses capture time only when the Meta timestamp is not trustworthy', () => {
    const payload = buildMetaAdAttributionPayload({
      ...BASE_INPUT,
      whatsappMessageTimestamp: 'not-a-timestamp',
      referral: COMPLETE_REFERRAL,
      now: () => new Date('2026-09-11T12:00:00.000Z'),
    });

    expect(payload?.received_at).toBe('2026-09-11T12:00:00.000Z');
  });
});

describe('CTWA attribution persistence', () => {
  it('uses the account-scoped CTWA uniqueness boundary', async () => {
    const { db, upsert } = attributionDb();

    await captureMetaAdAttribution(db, {
      ...BASE_INPUT,
      referral: COMPLETE_REFERRAL,
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'account-1',
        ctwa_clid: 'TEST_ctwa-AbC123_xyz',
      }),
      {
        onConflict: 'account_id,ctwa_clid',
        ignoreDuplicates: true,
      }
    );
  });

  it('keeps exactly one row for an identical replay', async () => {
    const { db, rows } = attributionDb();
    const input = { ...BASE_INPUT, referral: COMPLETE_REFERRAL };

    await captureMetaAdAttribution(db, input);
    await captureMetaAdAttribution(db, input);

    expect(rows).toHaveLength(1);
  });

  it('does not erase good fields when a replay is partial', async () => {
    const { db, rows } = attributionDb();

    await captureMetaAdAttribution(db, {
      ...BASE_INPUT,
      referral: COMPLETE_REFERRAL,
    });
    await captureMetaAdAttribution(db, {
      ...BASE_INPUT,
      referral: {
        source_type: 'ad',
        ctwa_clid: COMPLETE_REFERRAL.ctwa_clid,
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].referral_headline).toBe('Apartamento Eusébio');
  });

  it('keeps separate clicks from the same contact', async () => {
    const { db, rows } = attributionDb();

    await captureMetaAdAttribution(db, {
      ...BASE_INPUT,
      referral: { source_type: 'ad', ctwa_clid: 'AAA' },
    });
    await captureMetaAdAttribution(db, {
      ...BASE_INPUT,
      whatsappMessageId: 'wamid.CTWA2',
      referral: { source_type: 'ad', ctwa_clid: 'BBB' },
    });

    expect(rows.map((row) => row.ctwa_clid)).toEqual(['AAA', 'BBB']);
  });

  async function expectCaptureIndependentOfMetaConfig() {
    const { db, rows, tables } = attributionDb();

    await captureMetaAdAttribution(db, {
      ...BASE_INPUT,
      referral: COMPLETE_REFERRAL,
    });

    expect(rows).toHaveLength(1);
    expect(tables).toEqual(['meta_ad_attributions']);
    expect(tables).not.toContain('meta_conversion_config');
    expect(tables).not.toContain('meta_conversion_events');
  }

  it('captures when Meta conversions config is disabled', async () => {
    await expectCaptureIndependentOfMetaConfig();
  });

  it('captures when Meta conversions config is missing', async () => {
    await expectCaptureIndependentOfMetaConfig();
  });

  it('does not create conversion events or call any external Meta endpoint', async () => {
    const { db, tables } = attributionDb();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('external call must not happen'));

    try {
      await captureMetaAdAttribution(db, {
        ...BASE_INPUT,
        referral: COMPLETE_REFERRAL,
      });

      expect(tables).toEqual(['meta_ad_attributions']);
      expect(tables).not.toContain('meta_conversion_events');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('surfaces only a sanitized database code', async () => {
    const { db } = attributionDb({ failureCode: '08006' });

    const promise = captureMetaAdAttribution(db, {
      ...BASE_INPUT,
      referral: COMPLETE_REFERRAL,
    });

    await expect(promise).rejects.toEqual(
      new MetaAttributionPersistenceError('08006')
    );
    await expect(promise).rejects.not.toThrow('secret-token');
  });
});
