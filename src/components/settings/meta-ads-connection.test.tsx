// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

vi.mock('next/script', () => ({ default: () => null }));
vi.mock('next-intl', () => ({
  useTranslations:
    (namespace: keyof typeof messages) =>
    (key: string, values?: Record<string, string>) => {
      let value = (messages[namespace] as Record<string, string>)[key] ?? key;
      for (const [name, replacement] of Object.entries(values ?? {})) {
        value = value.replace(`{${name}}`, replacement);
      }
      return value;
    },
  useFormatter: () => ({ dateTime: () => '10/23/2026, 12:00 PM' }),
}));

import { MetaAdsConnection } from './meta-ads-connection';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MetaAdsConnection', () => {
  it('shows the official login action and keeps manual token controls collapsed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          connected: false,
          source: null,
          adAccount: null,
          connectedAt: null,
          sdkConfig: { appId: '12345', configId: '67890', version: 'v21.0' },
        })
      )
    );
    render(
      <MetaAdsConnection canEdit onChanged={() => {}} refreshKey={0}>
        <span>Manual secret field</span>
      </MetaAdsConnection>
    );
    expect(
      await screen.findByRole('button', { name: 'Connect Meta Ads account' })
    ).toBeTruthy();
    const advanced = screen
      .getByText('Advanced (manual token)')
      .closest('details');
    expect(advanced?.hasAttribute('open')).toBe(false);
  });

  it('shows only safe connected account metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          connected: true,
          source: 'facebook_login',
          adAccount: { id: 'act_12345', name: 'Review account' },
          connectedAt: '2026-10-23T15:00:00.000Z',
          sdkConfig: { appId: '12345', configId: '67890', version: 'v21.0' },
        })
      )
    );
    render(
      <MetaAdsConnection canEdit onChanged={() => {}} refreshKey={0}>
        <span>Manual secret field</span>
      </MetaAdsConnection>
    );
    await waitFor(() =>
      expect(
        screen.getByText('Connected: Review account (act_12345)')
      ).toBeTruthy()
    );
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('access_token');
  });
});
