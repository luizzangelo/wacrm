import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { metaConversionsAdmin } from '@/lib/meta-conversions/admin-client';
import {
  createMetaConversionEventRepository,
  processMetaConversionEventBatch,
} from '@/lib/meta-conversions/conversion-sender';

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

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!hasValidCronSecret(request, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await processMetaConversionEventBatch({
      repository: createMetaConversionEventRepository(metaConversionsAdmin()),
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[meta-conversions][delivery] batch failed', {
      result: 'error',
      error_code:
        error && typeof error === 'object' && 'code' in error
          ? String(error.code).slice(0, 64)
          : 'unknown',
    });
    return NextResponse.json(
      { error: 'conversion delivery batch failed' },
      { status: 500 }
    );
  }
}
