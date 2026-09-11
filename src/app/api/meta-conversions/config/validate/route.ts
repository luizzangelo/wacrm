import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { metaConversionsAdmin } from '@/lib/meta-conversions/admin-client';
import {
  createMetaConversionsRepository,
  MetaConversionsConfigError,
} from '@/lib/meta-conversions/config';
import { validateStoredMetaConversionConfig } from '@/lib/meta-conversions/validate';

export async function POST() {
  try {
    const { accountId } = await requireRole('admin');
    const repository = createMetaConversionsRepository(metaConversionsAdmin());
    const validation = await validateStoredMetaConversionConfig(
      repository,
      accountId
    );

    console.info('[meta-conversions] validation', {
      account_id: accountId,
      dataset_status: validation.dataset.status,
      dataset_http_status: validation.dataset.http_status,
      dataset_error_code: validation.dataset.error_code,
      marketing_status: validation.marketing_token.status,
      marketing_http_status: validation.marketing_token.http_status,
      marketing_error_code: validation.marketing_token.error_code,
    });

    return NextResponse.json(validation);
  } catch (error) {
    if (error instanceof MetaConversionsConfigError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    return toErrorResponse(error);
  }
}
