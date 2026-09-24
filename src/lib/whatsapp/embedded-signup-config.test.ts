import { afterEach, describe, expect, it } from 'vitest';
import {
  getEmbeddedSignupPublicConfig,
  getEmbeddedSignupServerConfig,
} from './embedded-signup-config';
import { parseEmbeddedSignupRequest } from './embedded-signup-schema';

const original = {
  appId: process.env.NEXT_PUBLIC_META_APP_ID,
  configId: process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID,
  secret: process.env.META_APP_SECRET,
  version: process.env.META_EMBEDDED_SIGNUP_GRAPH_VERSION,
  redirectUri: process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_REDIRECT_URI,
};

afterEach(() => {
  process.env.NEXT_PUBLIC_META_APP_ID = original.appId;
  process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID = original.configId;
  process.env.META_APP_SECRET = original.secret;
  process.env.META_EMBEDDED_SIGNUP_GRAPH_VERSION = original.version;
  process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_REDIRECT_URI =
    original.redirectUri;
});

describe('Embedded Signup configuration', () => {
  it('fails closed when either public identifier is missing', () => {
    delete process.env.NEXT_PUBLIC_META_APP_ID;
    process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID = '1449663160367056';
    expect(() => getEmbeddedSignupPublicConfig()).toThrow(
      'NEXT_PUBLIC_META_APP_ID'
    );

    process.env.NEXT_PUBLIC_META_APP_ID = '1661839952034827';
    delete process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID;
    expect(() => getEmbeddedSignupPublicConfig()).toThrow(
      'NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID'
    );
  });

  it('keeps the app secret server-only and validates the Graph version', () => {
    process.env.NEXT_PUBLIC_META_APP_ID = '1661839952034827';
    process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID = '1449663160367056';
    process.env.META_APP_SECRET = 'server-only-secret';
    process.env.META_EMBEDDED_SIGNUP_GRAPH_VERSION = 'v26.0';
    process.env.META_EMBEDDED_SIGNUP_GRAPH_VERSION = '26.0';
    process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_REDIRECT_URI =
      'https://crm.luizangelo.com.br/';
    expect(getEmbeddedSignupPublicConfig()).toEqual({
      appId: '1661839952034827',
      configId: '1449663160367056',
      graphVersion: 'v26.0',
      redirectUri: 'https://crm.luizangelo.com.br/',
    });
    expect(getEmbeddedSignupServerConfig().appSecret).toBe(
      'server-only-secret'
    );
    expect(getEmbeddedSignupPublicConfig()).not.toHaveProperty('appSecret');
  });

  it('requires an exact HTTPS origin root with a trailing slash', () => {
    process.env.NEXT_PUBLIC_META_APP_ID = '1661839952034827';
    process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID = '1449663160367056';
    process.env.META_APP_SECRET = 'server-only-secret';
    process.env.META_EMBEDDED_SIGNUP_GRAPH_VERSION = 'v26.0';
    process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_REDIRECT_URI =
      'http://crm.luizangelo.com.br/';
    expect(() => getEmbeddedSignupServerConfig()).toThrow(
      'NEXT_PUBLIC_META_EMBEDDED_SIGNUP_REDIRECT_URI'
    );

    process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_REDIRECT_URI =
      'https://crm.luizangelo.com.br';
    expect(getEmbeddedSignupServerConfig().redirectUri).toBe(
      'https://crm.luizangelo.com.br/'
    );
  });
});

describe('Embedded Signup request schema', () => {
  const baseCompletion = {
    kind: 'complete',
    flow_mode: 'coexistence',
    waba_id: '2295585011204142',
  } as const;

  it('accepts a completion without phone_number_id', () => {
    expect(
      parseEmbeddedSignupRequest({
        ...baseCompletion,
        code: 'authorization-code-123',
      })
    ).toEqual({
      kind: 'complete',
      code: 'authorization-code-123',
      flowMode: 'coexistence',
      wabaId: '2295585011204142',
      phoneNumberId: null,
      businessId: null,
    });
  });

  it('accepts varied opaque authorization codes without modifying them', () => {
    const codes = [
      'lettersAZaz',
      'numbers0123456789',
      'underscore_hyphen-point.~',
      'url/safe+opaque=code%2Fvalue?x:y@z',
      "other !$&'()*;,=[]{}|\\ characters",
    ];

    for (const code of codes) {
      const parsed = parseEmbeddedSignupRequest({
        ...baseCompletion,
        code,
      });
      expect(parsed).toMatchObject({ code });
    }
  });

  it('rejects empty, oversized and non-string authorization codes', () => {
    for (const code of ['', 'x'.repeat(4097), 123, null, {}]) {
      expect(
        parseEmbeddedSignupRequest({
          ...baseCompletion,
          code,
        })
      ).toBeNull();
    }
  });

  it('accepts authorization codes at the defensive size limit', () => {
    const code = 'x'.repeat(4096);
    expect(
      parseEmbeddedSignupRequest({
        ...baseCompletion,
        code,
      })
    ).toMatchObject({ code });
  });

  it('rejects unknown fields and malformed ids', () => {
    expect(
      parseEmbeddedSignupRequest({
        kind: 'complete',
        code: 'short',
        waba_id: 'not-an-id',
        account_id: 'forged',
      })
    ).toBeNull();

    expect(
      parseEmbeddedSignupRequest({
        kind: 'complete',
        code: 'authorization-code-123',
        flow_mode: 'standard',
        waba_id: '2295585011204142',
        redirect_uri: 'https://attacker.example/',
      })
    ).toBeNull();
  });
});
