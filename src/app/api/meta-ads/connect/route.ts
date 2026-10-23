import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { metaConversionsAdmin } from '@/lib/meta-conversions/admin-client';
import { MetaAdsApiError } from '@/lib/meta-ads/meta-client';
import { connectMetaAds } from '@/lib/meta-ads/service';

function errorResponse(error: unknown) {
  if (error instanceof MetaAdsApiError) {
    return NextResponse.json(
      { error: error.publicCode },
      { status: error.status }
    );
  }
  if (
    error instanceof Error &&
    ['invalid_connect_request', 'invalid_ad_account_selection'].includes(
      error.message
    )
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return toErrorResponse(error);
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin');
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const code =
      typeof body?.code === 'string' && body.code.trim()
        ? body.code.trim()
        : undefined;
    const adAccountId =
      typeof body?.adAccountId === 'string' &&
      /^act_\d{5,30}$/.test(body.adAccountId)
        ? body.adAccountId
        : undefined;
    if ((!code && !adAccountId) || (code && adAccountId)) {
      return NextResponse.json(
        { error: 'invalid_connect_request' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      await connectMetaAds(metaConversionsAdmin(), accountId, {
        code,
        adAccountId,
      })
    );
  } catch (error) {
    return errorResponse(error);
  }
}
