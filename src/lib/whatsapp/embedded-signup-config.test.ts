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
};

afterEach(() => {
  process.env.NEXT_PUBLIC_META_APP_ID = original.appId;
  process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID = original.configId;
  process.env.META_APP_SECRET = original.secret;
  process.env.META_EMBEDDED_SIGNUP_GRAPH_VERSION = original.version;
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
    process.env.META_EMBEDDED_SIGNUP_GRAPH_VERSION = '26.0';
    expect(getEmbeddedSignupPublicConfig()).toEqual({
      appId: '1661839952034827',
      configId: '1449663160367056',
      graphVersion: 'v26.0',
    });
    expect(getEmbeddedSignupServerConfig().appSecret).toBe(
      'server-only-secret'
    );
    expect(getEmbeddedSignupPublicConfig()).not.toHaveProperty('appSecret');
  });
});

describe('Embedded Signup request schema', () => {
  it('accepts a completion without phone_number_id', () => {
    expect(
      parseEmbeddedSignupRequest({
        kind: 'complete',
        code: 'authorization-code-123',
        waba_id: '2295585011204142',
      })
    ).toEqual({
      kind: 'complete',
      code: 'authorization-code-123',
      wabaId: '2295585011204142',
      phoneNumberId: null,
      businessId: null,
    });
  });

  it('rejects unknown fields, malformed ids and short codes', () => {
    expect(
      parseEmbeddedSignupRequest({
        kind: 'complete',
        code: 'short',
        waba_id: 'not-an-id',
        account_id: 'forged',
      })
    ).toBeNull();
  });
});
