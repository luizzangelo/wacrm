import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetFacebookSdkForTests,
  initializeFacebookSdk,
  parseEmbeddedSignupMessage,
} from './embedded-signup-browser';

beforeEach(() => __resetFacebookSdkForTests());

describe('Embedded Signup browser boundary', () => {
  it('initializes the SDK only once for the same app', () => {
    const sdk = { init: vi.fn(), login: vi.fn() };
    initializeFacebookSdk(sdk, '1661839952034827');
    initializeFacebookSdk(sdk, '1661839952034827');
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledWith({
      appId: '1661839952034827',
      cookie: true,
      xfbml: false,
      version: 'v26.0',
    });
  });

  it('rejects malicious lookalike origins and malformed payloads', () => {
    const message = {
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      data: { waba_id: '2295585011204142' },
    };
    expect(
      parseEmbeddedSignupMessage(
        'https://www.facebook.com.evil.example',
        message
      )
    ).toBeNull();
    expect(
      parseEmbeddedSignupMessage('https://www.facebook.com', '{not-json')
    ).toBeNull();
  });

  it('accepts the coexistence finish without phone_number_id', () => {
    expect(
      parseEmbeddedSignupMessage(
        'https://www.facebook.com',
        JSON.stringify({
          type: 'WA_EMBEDDED_SIGNUP',
          event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
          version: 3,
          data: { waba_id: '2295585011204142' },
        })
      )
    ).toEqual({
      kind: 'finish',
      event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      flowMode: 'coexistence',
      wabaId: '2295585011204142',
      phoneNumberId: null,
      businessId: null,
    });
  });

  it.each([
    ['FINISH', 'standard'],
    ['FINISH_ONLY_WABA', 'standard'],
  ] as const)('maps %s to the standard flow', (event, flowMode) => {
    expect(
      parseEmbeddedSignupMessage('https://www.facebook.com', {
        type: 'WA_EMBEDDED_SIGNUP',
        event,
        data: { waba_id: '2295585011204142' },
      })
    ).toMatchObject({ kind: 'finish', event, flowMode });
  });

  it.each(['CANCEL', 'ERROR'] as const)(
    'handles %s without trusting data',
    (event) => {
      expect(
        parseEmbeddedSignupMessage('https://web.facebook.com', {
          type: 'WA_EMBEDDED_SIGNUP',
          event,
        })
      ).toEqual({ kind: event.toLowerCase() });
    }
  );
});
