import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  DealStageMoveError,
  createDealStageRepository,
  moveDealToStage,
} from '@/lib/deals/move-deal-stage';
import { metaConversionsAdmin } from '@/lib/meta-conversions/admin-client';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(error: DealStageMoveError): NextResponse {
  const body: { error: string; currentStageId?: string } = {
    error: error.code,
  };
  if (error.code === 'stage_conflict' && error.currentStageId) {
    body.currentStageId = error.currentStageId;
  }
  return NextResponse.json(body, { status: error.status });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { accountId, userId } = await requireRole('agent');
    const { dealId } = await params;
    if (!UUID_RE.test(dealId)) {
      return NextResponse.json({ error: 'invalid_deal_id' }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as {
      stageId?: unknown;
    } | null;
    if (typeof body?.stageId !== 'string' || !UUID_RE.test(body.stageId)) {
      return NextResponse.json({ error: 'invalid_stage_id' }, { status: 400 });
    }

    const result = await moveDealToStage(
      createDealStageRepository(metaConversionsAdmin()),
      {
        accountId,
        actorUserId: userId,
        dealId,
        newStageId: body.stageId,
      }
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DealStageMoveError) return errorResponse(error);
    return toErrorResponse(error);
  }
}
