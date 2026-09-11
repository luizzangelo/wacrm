const configuredVersion = process.env.META_CONVERSIONS_API_VERSION?.trim();

/**
 * Kept separate from the existing WhatsApp Graph API version on purpose.
 * This integration can be upgraded independently without changing message
 * delivery behaviour.
 */
export const META_CONVERSIONS_API_VERSION = configuredVersion
  ? configuredVersion.startsWith('v')
    ? configuredVersion
    : `v${configuredVersion}`
  : 'v26.0';

export const META_CONVERSIONS_GRAPH_BASE = `https://graph.facebook.com/${META_CONVERSIONS_API_VERSION}`;

export const META_CONVERSIONS_REQUEST_TIMEOUT_MS = 10_000;
