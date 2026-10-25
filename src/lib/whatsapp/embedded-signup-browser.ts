export const META_POST_MESSAGE_ORIGINS = new Set([
  'https://www.facebook.com',
  'https://web.facebook.com',
]);

export type EmbeddedSignupSessionEvent =
  | {
      kind: 'finish';
      event:
        | 'FINISH'
        | 'FINISH_ONLY_WABA'
        | 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';
      flowMode: 'standard' | 'coexistence';
      wabaId: string;
      phoneNumberId: string | null;
      businessId: string | null;
    }
  | { kind: 'cancel' }
  | { kind: 'error' };

const META_ID = /^\d{5,30}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseEmbeddedSignupMessage(
  origin: string,
  rawData: unknown
): EmbeddedSignupSessionEvent | null {
  if (!META_POST_MESSAGE_ORIGINS.has(origin)) return null;
  let parsed = rawData;
  if (typeof rawData === 'string') {
    try {
      parsed = JSON.parse(rawData);
    } catch {
      return null;
    }
  }
  const envelope = record(parsed);
  if (!envelope || envelope.type !== 'WA_EMBEDDED_SIGNUP') return null;
  const event = typeof envelope.event === 'string' ? envelope.event : '';
  if (event === 'CANCEL') return { kind: 'cancel' };
  if (event === 'ERROR') return { kind: 'error' };
  if (
    event !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' &&
    event !== 'FINISH' &&
    event !== 'FINISH_ONLY_WABA'
  ) {
    return null;
  }
  const data = record(envelope.data);
  if (
    !data ||
    typeof data.waba_id !== 'string' ||
    !META_ID.test(data.waba_id)
  ) {
    return null;
  }
  const phoneNumberId =
    typeof data.phone_number_id === 'string' &&
    META_ID.test(data.phone_number_id)
      ? data.phone_number_id
      : null;
  const businessId =
    typeof data.business_id === 'string' && META_ID.test(data.business_id)
      ? data.business_id
      : null;
  return {
    kind: 'finish',
    event,
    flowMode:
      event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'
        ? 'coexistence'
        : 'standard',
    wabaId: data.waba_id,
    phoneNumberId,
    businessId,
  };
}

export interface FacebookLoginResponse {
  authResponse?: { code?: string };
  status?: string;
}

export interface FacebookSdk {
  init(options: {
    appId: string;
    cookie: boolean;
    xfbml: boolean;
    version: string;
  }): void;
  login(
    callback: (response: FacebookLoginResponse) => void,
    options: {
      config_id: string;
      response_type: 'code';
      override_default_response_type: true;
      extras: {
        setup: Record<string, never>;
        featureType: 'whatsapp_business_app_onboarding';
        sessionInfoVersion: '3';
      };
    }
  ): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
  }
}

let initializedAppId: string | null = null;

export function initializeFacebookSdk(
  sdk: FacebookSdk,
  appId: string,
  graphVersion = 'v26.0'
) {
  if (initializedAppId === appId) return;
  sdk.init({ appId, cookie: true, xfbml: false, version: graphVersion });
  initializedAppId = appId;
}

export function __resetFacebookSdkForTests() {
  initializedAppId = null;
}
