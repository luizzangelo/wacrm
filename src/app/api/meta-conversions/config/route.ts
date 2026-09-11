import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { metaConversionsAdmin } from '@/lib/meta-conversions/admin-client';
import {
  createMetaConversionsRepository,
  getSafeMetaConversionConfig,
  MetaConversionsConfigError,
  parseMetaConversionConfigPatch,
  saveMetaConversionConfig,
} from '@/lib/meta-conversions/config';

function configErrorResponse(error: unknown) {
  if (error instanceof MetaConversionsConfigError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  }
  return toErrorResponse(error);
}

/** Any authenticated workspace member may read the secret-free status. */
export async function GET() {
  try {
    const { accountId } = await getCurrentAccount();
    const repository = createMetaConversionsRepository(metaConversionsAdmin());
    return NextResponse.json(
      await getSafeMetaConversionConfig(repository, accountId)
    );
  } catch (error) {
    return configErrorResponse(error);
  }
}

/** Admin+ may create or update the workspace configuration. */
export async function PATCH(request: Request) {
  try {
    const { accountId } = await requireRole('admin');
    const body = await request.json().catch(() => null);
    const patch = parseMetaConversionConfigPatch(body);
    const repository = createMetaConversionsRepository(metaConversionsAdmin());
    const safeConfig = await saveMetaConversionConfig(
      repository,
      accountId,
      patch
    );
    return NextResponse.json(safeConfig);
  } catch (error) {
    return configErrorResponse(error);
  }
}
