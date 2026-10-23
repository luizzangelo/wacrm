const META_ID = /^\d{5,30}$/;
const GRAPH_VERSION = /^v\d+\.\d+$/;

export interface MetaAdsServerConfig {
  appId: string;
  appSecret: string;
  loginConfigId: string;
  graphVersion: string;
}

export function getMetaAdsServerConfig(): MetaAdsServerConfig {
  const appId = process.env.META_APP_ID?.trim() ?? '';
  const appSecret = process.env.META_APP_SECRET?.trim() ?? '';
  const loginConfigId = process.env.META_ADS_LOGIN_CONFIG_ID?.trim() ?? '';
  const graphVersion = (process.env.META_GRAPH_VERSION ?? 'v21.0').trim();

  if (!META_ID.test(appId)) throw new Error('META_APP_ID is not configured');
  if (!appSecret) throw new Error('META_APP_SECRET is not configured');
  if (!META_ID.test(loginConfigId))
    throw new Error('META_ADS_LOGIN_CONFIG_ID is not configured');
  if (!GRAPH_VERSION.test(graphVersion))
    throw new Error('META_GRAPH_VERSION is invalid');
  return { appId, appSecret, loginConfigId, graphVersion };
}
