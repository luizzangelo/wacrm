import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { authRequestAllowed } from '@/lib/auth/request';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit';
import { operationalErrorFields } from '@/lib/security/operational-log';

/**
 * Locally disables a coexistence connection without deregistering the phone,
 * deleting CRM history, or removing its encrypted recovery credential.
 *
 * Meta's coexistence documentation directs the customer to disconnect the
 * partner from the WhatsApp Business app. Calling Cloud API /deregister or
 * deleting local state first could disable the mobile app or make recovery
 * impossible, so this endpoint deliberately performs no Meta mutation.
 */
export async function POST(request: Request) {
  if (!authRequestAllowed(request)) {
    return NextResponse.json({ error: 'request_not_allowed' }, { status: 403 });
  }
  try {
    const context = await requireRole('admin');
    const limit = checkRateLimit(
      `embedded-signup-disconnect:${context.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'confirm') ||
      body.confirm !== true
    ) {
      return NextResponse.json(
        { error: 'confirmation_required' },
        { status: 400 }
      );
    }

    const { data: existing, error: readError } = await context.supabase
      .from('whatsapp_config')
      .select('id, connection_mode, status')
      .eq('account_id', context.accountId)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing) {
      return NextResponse.json({ error: 'no_configuration' }, { status: 404 });
    }
    if (existing.connection_mode !== 'coexistence') {
      return NextResponse.json(
        { error: 'manual_configuration_uses_reset' },
        { status: 409 }
      );
    }

    const { error: updateError } = await context.supabase
      .from('whatsapp_config')
      .update({
        status: 'disconnected',
        disconnected_at: new Date().toISOString(),
        disconnect_reason: 'user_requested_wacrm_disconnect',
        disconnect_initiated_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('account_id', context.accountId);
    if (updateError) throw updateError;

    return NextResponse.json({
      disconnected: true,
      history_preserved: true,
      requires_business_app_action: true,
    });
  } catch (error) {
    console.error(
      '[whatsapp/embedded-signup/disconnect] failed:',
      operationalErrorFields(error)
    );
    return toErrorResponse(error);
  }
}
