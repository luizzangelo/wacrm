const GRAPH_VERSION_PATTERN = /^v\d+\.\d+$/;
const META_ID_PATTERN = /^\d{5,30}$/;

export interface EmbeddedSignupPublicConfig {
  appId: string;
  configId: string;
  graphVersion: string;
  redirectUri: string;
}

export interface EmbeddedSignupServerConfig extends EmbeddedSignupPublicConfig {
  appSecret: string;
}

function normalizeGraphVersion(value: string | undefined): string {
  const normalized = value?.trim()
    ? value.trim().startsWith('v')
      ? value.trim()
      : `v${value.trim()}`
    : 'v26.0';
  if (!GRAPH_VERSION_PATTERN.test(normalized)) {
    throw new Error('Invalid META_EMBEDDED_SIGNUP_GRAPH_VERSION');
  }
  return normalized;
}

function requireMetaId(name: string, value: string | undefined): string {
  const normalized = value?.trim() ?? '';
  if (!META_ID_PATTERN.test(normalized))
    throw new Error(`Missing or invalid ${name}`);
  return normalized;
}

function requireRedirectUri(value: string | undefined): string {
  const normalized = value?.trim() ?? '';
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(
      'Missing or invalid NEXT_PUBLIC_META_EMBEDDED_SIGNUP_REDIRECT_URI'
    );
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'Missing or invalid NEXT_PUBLIC_META_EMBEDDED_SIGNUP_REDIRECT_URI'
    );
  }
  return url.toString();
}

export function getEmbeddedSignupPublicConfig(): EmbeddedSignupPublicConfig {
  return {
    appId: requireMetaId(
      'NEXT_PUBLIC_META_APP_ID',
      process.env.NEXT_PUBLIC_META_APP_ID
    ),
    configId: requireMetaId(
      'NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID',
      process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID
    ),
    graphVersion: normalizeGraphVersion(
      process.env.META_EMBEDDED_SIGNUP_GRAPH_VERSION
    ),
    redirectUri: requireRedirectUri(
      process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_REDIRECT_URI
    ),
  };
}

export function getEmbeddedSignupServerConfig(): EmbeddedSignupServerConfig {
  const publicConfig = getEmbeddedSignupPublicConfig();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appSecret) throw new Error('Missing META_APP_SECRET');
  return { ...publicConfig, appSecret };
}

export const EMBEDDED_SIGNUP_FEATURE_TYPE =
  'whatsapp_business_app_onboarding' as const;
export const EMBEDDED_SIGNUP_SESSION_INFO_VERSION = '3' as const;
