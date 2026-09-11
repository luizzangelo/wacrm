import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  createMetaEnrichmentRepository,
  processMetaAdEnrichmentBatch,
} from '@/lib/meta-conversions/enrichment';

export const maxDuration = 60;

function hasValidCronSecret(request: Request, expected: string): boolean {
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

/**
 * Retry the oldest pending/failed Meta attribution enrichments. This follows
 * the existing cron contract and deliberately processes a small bounded batch.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!hasValidCronSecret(request, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await processMetaAdEnrichmentBatch({
      repository: createMetaEnrichmentRepository(supabaseAdmin()),
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[meta-conversions][enrichment] batch failed', {
      status: 'failed',
      error_code:
        error && typeof error === 'object' && 'code' in error
          ? String(error.code).slice(0, 64)
          : 'unknown',
    });
    return NextResponse.json(
      { error: 'enrichment batch failed' },
      { status: 500 }
    );
  }
}
