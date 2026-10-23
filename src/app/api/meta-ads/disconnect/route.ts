import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { metaConversionsAdmin } from '@/lib/meta-conversions/admin-client';
import { disconnectMetaAds } from '@/lib/meta-ads/service';

export async function POST() {
  try {
    const { accountId } = await requireRole('admin');
    await disconnectMetaAds(metaConversionsAdmin(), accountId);
    return NextResponse.json({
      connected: false,
      source: null,
      adAccount: null,
      connectedAt: null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
