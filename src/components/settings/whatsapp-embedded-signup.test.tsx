// @vitest-environment jsdom

import { useEffect } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('next/script', () => ({
  default: function MockScript(props: { onReady?: () => void }) {
    useEffect(() => props.onReady?.(), [props]);
    return null;
  },
}));

import { WhatsAppEmbeddedSignup } from './whatsapp-embedded-signup';
import { __resetFacebookSdkForTests } from '@/lib/whatsapp/embedded-signup-browser';

const onChanged = vi.fn();
const login = vi.fn();
const init = vi.fn();

function renderComponent() {
  return render(
    <WhatsAppEmbeddedSignup canEdit connected={false} onChanged={onChanged} />
  );
}

beforeEach(() => {
  __resetFacebookSdkForTests();
  vi.stubGlobal('fetch', vi.fn());
  window.FB = { init, login };
  onChanged.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.FB;
});

describe('WhatsApp Embedded Signup UI', () => {
  it('uses the exact coexistence login options and completes when code arrives first', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ connected: true }), { status: 200 })
    );
    renderComponent();
    const button = await screen.findByRole('button', {
      name: 'Conectar WhatsApp',
    });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    fireEvent.click(button);
    expect(login).toHaveBeenCalledTimes(1);
    expect(login.mock.calls[0][1]).toEqual({
      config_id: '1449663160367056',
      response_type: 'code',
      override_default_response_type: true,
      extras: {
        setup: {},
        featureType: 'whatsapp_business_app_onboarding',
        sessionInfoVersion: '3',
      },
    });

    login.mock.calls[0][0]({
      authResponse: { code: 'authorization-code-123' },
    });
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://www.facebook.com',
        data: {
          type: 'WA_EMBEDDED_SIGNUP',
          event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
          version: 3,
          data: { waba_id: '2295585011204142' },
        },
      })
    );

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(sent).toEqual({
      kind: 'complete',
      code: 'authorization-code-123',
      waba_id: '2295585011204142',
      phone_number_id: null,
      business_id: null,
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('treats a closed popup as cancellation without calling the backend', async () => {
    renderComponent();
    const button = await screen.findByRole('button', {
      name: 'Conectar WhatsApp',
    });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    fireEvent.click(button);
    login.mock.calls[0][0]({ status: 'unknown' });
    await waitFor(() => expect(h.toast.info).toHaveBeenCalled());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores a valid-looking session event from an invalid origin', async () => {
    renderComponent();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://www.facebook.com.attacker.example',
        data: {
          type: 'WA_EMBEDDED_SIGNUP',
          event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
          data: { waba_id: '2295585011204142' },
        },
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).not.toHaveBeenCalled();
  });
});
