import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { authRequestAllowed } from '@/lib/auth/request';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import {
  getEmbeddedSignupServerConfig,
  type EmbeddedSignupServerConfig,
} from '@/lib/whatsapp/embedded-signup-config';
import {
  discoverWabaPhoneNumbers,
  EmbeddedSignupMetaError,
  exchangeAuthorizationCode,
  requestCoexistenceSync,
  subscribeAndConfirmWaba,
  validateAccessToken,
  type EmbeddedPhoneNumber,
  type ExchangedToken,
} from '@/lib/whatsapp/embedded-signup-meta';
import { parseEmbeddedSignupRequest } from '@/lib/whatsapp/embedded-signup-schema';
import { operationalErrorFields } from '@/lib/security/operational-log';

const PENDING_SESSION_TTL_MS = 10 * 60_000;

interface FinalizeContext {
  accountId: string;
  userId: string;
  config: EmbeddedSignupServerConfig;
  token: ExchangedToken;
  wabaId: string;
  businessId: string | null;
  phone: EmbeddedPhoneNumber;
  pendingSessionId?: string;
}

function errorResponse(error: EmbeddedSignupMetaError): NextResponse {
  const status =
    error.reason === 'exchange_outcome_unknown' ||
    error.reason === 'sync_outcome_unknown'
      ? 502
      : error.reason === 'missing_permissions'
        ? 403
        : 400;
  return NextResponse.json(
    {
      error: error.reason,
      ...(error.metaCode !== undefined ? { meta_code: error.metaCode } : {}),
      ...(error.metaSubcode !== undefined
        ? { meta_subcode: error.metaSubcode }
        : {}),
    },
    { status }
  );
}

function eligibleCoexistencePhones(phones: EmbeddedPhoneNumber[]) {
  return phones.filter(
    (phone) =>
      phone.isOnBizApp && phone.platformType?.toUpperCase() === 'CLOUD_API'
  );
}

async function persistPendingSelection(args: {
  accountId: string;
  userId: string;
  token: ExchangedToken;
  wabaId: string;
  businessId: string | null;
  phones: EmbeddedPhoneNumber[];
}) {
  const admin = supabaseAdmin();
  const now = new Date();
  await admin
    .from('whatsapp_embedded_signup_sessions')
    .delete()
    .eq('account_id', args.accountId)
    .is('consumed_at', null)
    .lt('expires_at', now.toISOString());

  const { data, error } = await admin
    .from('whatsapp_embedded_signup_sessions')
    .insert({
      account_id: args.accountId,
      user_id: args.userId,
      encrypted_access_token: encrypt(args.token.accessToken),
      waba_id: args.wabaId,
      meta_business_id: args.businessId,
      token_type: args.token.tokenType,
      token_expires_at: args.token.expiresAt,
      candidates: args.phones.map((phone) => ({
        id: phone.id,
        display_phone_number: phone.displayPhoneNumber,
        verified_name: phone.verifiedName,
        is_on_biz_app: phone.isOnBizApp,
        platform_type: phone.platformType,
      })),
      expires_at: new Date(
        now.getTime() + PENDING_SESSION_TTL_MS
      ).toISOString(),
    })
    .select('id')
    .single();
  if (error || !data?.id) throw new Error('pending_session_persistence_failed');
  return data.id as string;
}

async function recordSync(
  context: FinalizeContext,
  type: 'smb_app_state_sync' | 'history'
) {
  const admin = supabaseAdmin();
  const prefix = type === 'history' ? 'history_sync' : 'app_state_sync';
  const requestingAt = new Date().toISOString();
  await admin
    .from('whatsapp_config')
    .update({
      [`${prefix}_status`]: 'requesting',
      [`${prefix}_requested_at`]: requestingAt,
      [`${prefix}_error`]: null,
    })
    .eq('account_id', context.accountId)
    .eq('phone_number_id', context.phone.id);

  try {
    const requestId = await requestCoexistenceSync(
      context.config,
      context.token.accessToken,
      context.phone.id,
      type
    );
    await admin
      .from('whatsapp_config')
      .update({
        [`${prefix}_status`]: 'requested',
        [`${prefix}_request_id`]: requestId,
      })
      .eq('account_id', context.accountId)
      .eq('phone_number_id', context.phone.id);
    return 'requested' as const;
  } catch (error) {
    const outcomeUnknown =
      error instanceof EmbeddedSignupMetaError &&
      error.reason === 'sync_outcome_unknown';
    const status = outcomeUnknown ? 'delivery_unknown' : 'failed';
    const reason =
      error instanceof EmbeddedSignupMetaError ? error.reason : 'sync_failed';
    await admin
      .from('whatsapp_config')
      .update({ [`${prefix}_status`]: status, [`${prefix}_error`]: reason })
      .eq('account_id', context.accountId)
      .eq('phone_number_id', context.phone.id);
    return status;
  }
}

async function finalizeConnection(
  context: FinalizeContext
): Promise<NextResponse> {
  const admin = supabaseAdmin();
  const { data: claimed, error: claimError } = await admin
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', context.phone.id)
    .neq('account_id', context.accountId)
    .maybeSingle();
  if (claimError) throw new Error('asset_ownership_check_failed');
  if (claimed) {
    return NextResponse.json(
      { error: 'phone_already_connected' },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  const { error: saveError } = await admin.from('whatsapp_config').upsert(
    {
      account_id: context.accountId,
      user_id: context.userId,
      phone_number_id: context.phone.id,
      waba_id: context.wabaId,
      access_token: encrypt(context.token.accessToken),
      status: 'disconnected',
      connected_at: null,
      connection_mode: 'coexistence',
      meta_business_id: context.businessId,
      is_on_biz_app: context.phone.isOnBizApp,
      platform_type: context.phone.platformType,
      token_type: context.token.tokenType,
      token_expires_at: context.token.expiresAt,
      onboarding_completed_at: now,
      subscription_status: 'pending',
      app_state_sync_status: 'not_requested',
      app_state_sync_requested_at: null,
      app_state_sync_completed_at: null,
      app_state_sync_request_id: null,
      app_state_sync_error: null,
      history_sync_status: 'not_requested',
      history_sync_requested_at: null,
      history_sync_completed_at: null,
      history_sync_request_id: null,
      history_sync_error: null,
      disconnected_at: null,
      disconnect_reason: null,
      disconnect_initiated_by: null,
      registered_at: null,
      last_registration_error: null,
      updated_at: now,
    },
    { onConflict: 'account_id' }
  );
  if (saveError) {
    if (saveError.code === '23505') {
      return NextResponse.json(
        { error: 'phone_already_connected' },
        { status: 409 }
      );
    }
    throw new Error('connection_persistence_failed');
  }

  try {
    await subscribeAndConfirmWaba(
      context.config,
      context.token.accessToken,
      context.wabaId
    );
  } catch (error) {
    await admin
      .from('whatsapp_config')
      .update({
        status: 'disconnected',
        subscription_status: 'failed',
        last_registration_error:
          error instanceof EmbeddedSignupMetaError
            ? error.reason
            : 'subscription_failed',
      })
      .eq('account_id', context.accountId)
      .eq('phone_number_id', context.phone.id);
    if (error instanceof EmbeddedSignupMetaError) return errorResponse(error);
    throw error;
  }

  await admin
    .from('whatsapp_config')
    .update({
      status: 'connected',
      connected_at: now,
      subscription_status: 'subscribed',
      subscribed_apps_at: now,
    })
    .eq('account_id', context.accountId)
    .eq('phone_number_id', context.phone.id);

  // Each official sync endpoint is called exactly once here. A network
  // ambiguity becomes terminal delivery_unknown; this route never retries it.
  const appStateSync = await recordSync(context, 'smb_app_state_sync');
  const historySync = await recordSync(context, 'history');

  if (context.pendingSessionId) {
    await admin
      .from('whatsapp_embedded_signup_sessions')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', context.pendingSessionId)
      .eq('account_id', context.accountId);
  }

  return NextResponse.json({
    connected: true,
    connection_mode: 'coexistence',
    phone: {
      display_number: context.phone.displayPhoneNumber,
      verified_name: context.phone.verifiedName,
    },
    subscription_status: 'subscribed',
    sync: { app_state: appStateSync, history: historySync },
  });
}

export async function POST(request: Request) {
  if (!authRequestAllowed(request)) {
    return NextResponse.json({ error: 'request_not_allowed' }, { status: 403 });
  }

  try {
    const context = await requireRole('admin');
    const limit = checkRateLimit(
      `embedded-signup:${context.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = parseEmbeddedSignupRequest(
      await request.json().catch(() => null)
    );
    if (!body)
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    const config = getEmbeddedSignupServerConfig();

    if (body.kind === 'select') {
      const admin = supabaseAdmin();
      const { data: pending, error } = await admin
        .from('whatsapp_embedded_signup_sessions')
        .select(
          'id, encrypted_access_token, waba_id, meta_business_id, token_type, token_expires_at, candidates, expires_at, consumed_at'
        )
        .eq('id', body.sessionId)
        .eq('account_id', context.accountId)
        .maybeSingle();
      if (
        error ||
        !pending ||
        pending.consumed_at ||
        new Date(pending.expires_at).getTime() <= Date.now()
      ) {
        return NextResponse.json(
          { error: 'selection_session_expired' },
          { status: 410 }
        );
      }
      const candidates = Array.isArray(pending.candidates)
        ? pending.candidates
        : [];
      if (
        !candidates.some(
          (candidate) =>
            !!candidate &&
            typeof candidate === 'object' &&
            String((candidate as Record<string, unknown>).id) ===
              body.phoneNumberId
        )
      ) {
        return NextResponse.json(
          { error: 'invalid_phone_selection' },
          { status: 400 }
        );
      }
      const accessToken = decrypt(pending.encrypted_access_token);
      await validateAccessToken(config, accessToken);
      const phones = eligibleCoexistencePhones(
        await discoverWabaPhoneNumbers(config, accessToken, pending.waba_id)
      );
      const phone = phones.find((item) => item.id === body.phoneNumberId);
      if (!phone)
        return NextResponse.json(
          { error: 'invalid_phone_selection' },
          { status: 400 }
        );
      return finalizeConnection({
        accountId: context.accountId,
        userId: context.userId,
        config,
        token: {
          accessToken,
          tokenType: pending.token_type,
          expiresAt: pending.token_expires_at,
        },
        wabaId: pending.waba_id,
        businessId: pending.meta_business_id,
        phone,
        pendingSessionId: pending.id,
      });
    }

    const token = await exchangeAuthorizationCode(config, body.code);
    const validated = await validateAccessToken(config, token.accessToken);
    if (
      validated.granularWabaIds.length > 0 &&
      !validated.granularWabaIds.includes(body.wabaId)
    ) {
      throw new EmbeddedSignupMetaError('invalid_waba');
    }
    const eligible = eligibleCoexistencePhones(
      await discoverWabaPhoneNumbers(config, token.accessToken, body.wabaId)
    );
    if (body.phoneNumberId) {
      const selected = eligible.find(
        (phone) => phone.id === body.phoneNumberId
      );
      if (!selected) throw new EmbeddedSignupMetaError('invalid_phone');
      return finalizeConnection({
        accountId: context.accountId,
        userId: context.userId,
        config,
        token,
        wabaId: body.wabaId,
        businessId: body.businessId,
        phone: selected,
      });
    }
    if (eligible.length === 0)
      throw new EmbeddedSignupMetaError('invalid_phone');
    if (eligible.length > 1) {
      const sessionId = await persistPendingSelection({
        accountId: context.accountId,
        userId: context.userId,
        token,
        wabaId: body.wabaId,
        businessId: body.businessId,
        phones: eligible,
      });
      return NextResponse.json({
        connected: false,
        requires_phone_selection: true,
        selection_session_id: sessionId,
        phone_numbers: eligible.map((phone) => ({
          id: phone.id,
          display_number: phone.displayPhoneNumber,
          verified_name: phone.verifiedName,
        })),
      });
    }
    return finalizeConnection({
      accountId: context.accountId,
      userId: context.userId,
      config,
      token,
      wabaId: body.wabaId,
      businessId: body.businessId,
      phone: eligible[0],
    });
  } catch (error) {
    if (error instanceof EmbeddedSignupMetaError) return errorResponse(error);
    console.error(
      '[whatsapp/embedded-signup/complete] failed:',
      operationalErrorFields(error)
    );
    return toErrorResponse(error);
  }
}
