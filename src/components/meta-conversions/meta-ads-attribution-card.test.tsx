import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { MetaAdAttributionView } from '@/lib/meta-conversions/attribution-view';

const messages: Record<string, string> = {
  title: 'Meta Ads source',
  badge: 'Meta Ads',
  campaign: 'Campaign',
  adSet: 'Ad set',
  ad: 'Ad',
  pending: 'Campaign details pending',
  failed: 'The campaign details could not be identified.',
  recordedAt: 'Source recorded at: {date}',
  dealFixed: 'Source linked to this deal',
  contactPreview: "Contact's Meta Ads source — preview only",
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    let message = messages[key] ?? key;
    for (const [name, value] of Object.entries(values ?? {})) {
      message = message.replace(`{${name}}`, value);
    }
    return message;
  },
  useFormatter: () => ({
    dateTime: () => '09/11/2026, 09:30',
  }),
}));

import { MetaAdsAttributionCard } from './meta-ads-attribution-card';

function attribution(
  overrides: Partial<MetaAdAttributionView> = {}
): MetaAdAttributionView {
  return {
    id: 'attribution-1',
    account_id: 'account-1',
    contact_id: 'contact-1',
    ad_id: 'ad-123',
    ad_name: 'Apartment Ad',
    adset_id: 'adset-456',
    adset_name: 'Prospecting Set',
    campaign_id: 'campaign-789',
    campaign_name: 'September Campaign',
    enrichment_status: 'enriched',
    received_at: '2026-09-11T12:30:00.000Z',
    ...overrides,
  };
}

describe('MetaAdsAttributionCard', () => {
  it('renders the complete enriched campaign hierarchy and IDs', () => {
    const html = renderToStaticMarkup(
      <MetaAdsAttributionCard attribution={attribution()} />
    );

    expect(html).toContain('Meta Ads source');
    expect(html).toContain('Meta Ads');
    expect(html).toContain('September Campaign');
    expect(html).toContain('campaign-789');
    expect(html).toContain('Prospecting Set');
    expect(html).toContain('adset-456');
    expect(html).toContain('Apartment Ad');
    expect(html).toContain('ad-123');
    expect(html).toContain('Source recorded at: 09/11/2026, 09:30');
  });

  it('renders a pending state without inventing hierarchy names', () => {
    const html = renderToStaticMarkup(
      <MetaAdsAttributionCard
        attribution={attribution({
          enrichment_status: 'pending',
          campaign_name: null,
          adset_name: null,
          ad_name: null,
        })}
      />
    );

    expect(html).toContain('Campaign details pending');
    expect(html).not.toContain('September Campaign');
    expect(html).not.toContain('Prospecting Set');
    expect(html).not.toContain('Apartment Ad');
  });

  it('renders a friendly failed state without technical errors or CTWA data', () => {
    const unsafe = {
      ...attribution({ enrichment_status: 'failed' }),
      enrichment_error: 'OAuthException secret diagnostic',
      ctwa_clid: 'COMPLETE_CTWA_SECRET',
    };
    const html = renderToStaticMarkup(
      <MetaAdsAttributionCard attribution={unsafe} />
    );

    expect(html).toContain('The campaign details could not be identified.');
    expect(html).not.toContain('OAuthException secret diagnostic');
    expect(html).not.toContain('COMPLETE_CTWA_SECRET');
  });

  it('renders nothing when the contact has no attribution', () => {
    expect(
      renderToStaticMarkup(<MetaAdsAttributionCard attribution={null} />)
    ).toBe('');
  });

  it('distinguishes fixed deal attribution from contact preview', () => {
    const fixed = renderToStaticMarkup(
      <MetaAdsAttributionCard
        attribution={attribution()}
        context="deal_fixed"
      />
    );
    const preview = renderToStaticMarkup(
      <MetaAdsAttributionCard
        attribution={attribution()}
        context="contact_preview"
      />
    );

    expect(fixed).toContain('Source linked to this deal');
    expect(preview).toContain('Contact&#x27;s Meta Ads source — preview only');
  });

  it('uses the shared loading skeleton while attribution is loading', () => {
    const html = renderToStaticMarkup(
      <MetaAdsAttributionCard attribution={null} loading />
    );

    expect(html).toContain('data-meta-attribution-loading="true"');
    expect(html).toContain('animate-pulse');
  });
});
