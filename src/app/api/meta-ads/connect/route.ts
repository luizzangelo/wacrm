import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { metaConversionsAdmin } from '@/lib/meta-conversions/admin-client';
import { MetaAdsApiError } from '@/lib/meta-ads/meta-client';
import { connectMetaAds } from '@/lib/meta-ads/service';

function errorResponse(error: unknown) {
  if (error instanceof MetaAdsApiError) {
    return NextResponse.json(
      {
        error: error.publicCode,
        metaCode: error.metaCode ?? null,
        metaSubcode: error.metaSubcode ?? null,
      },
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

const claimedCodes = new Map<string, number>();
const CODE_TTL_MS = 10 * 60 * 1_000;

function claimAuthorizationCode(code: string) {
  const now = Date.now();
  for (const [fingerprint, claimedAt] of claimedCodes) {
    if (now - claimedAt > CODE_TTL_MS) claimedCodes.delete(fingerprint);
  }
  const fingerprint = createHash('sha256').update(code).digest('hex');
  if (claimedCodes.has(fingerprint)) {
    throw new MetaAdsApiError('authorization_code_expired_or_used', 400);
  }
  claimedCodes.set(fingerprint, now);
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
    if (code) claimAuthorizationCode(code);
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
