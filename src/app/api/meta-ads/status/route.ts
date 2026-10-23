import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { metaConversionsAdmin } from '@/lib/meta-conversions/admin-client';
import { getMetaAdsServerConfig } from '@/lib/meta-ads/config';
import { getMetaAdsStatus } from '@/lib/meta-ads/service';

export async function GET() {
  try {
    const { accountId } = await getCurrentAccount();
    const status = await getMetaAdsStatus(metaConversionsAdmin(), accountId);
    let sdkConfig: { appId: string; configId: string; version: string } | null =
      null;
    try {
      const config = getMetaAdsServerConfig();
      sdkConfig = {
        appId: config.appId,
        configId: config.loginConfigId,
        version: config.graphVersion,
      };
    } catch {
      // An unavailable server configuration is represented as null, never as env details.
    }
    return NextResponse.json({ ...status, sdkConfig });
  } catch (error) {
    return toErrorResponse(error);
  }
}
