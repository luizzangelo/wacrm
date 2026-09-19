import type { SupabaseClient } from '@supabase/supabase-js';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { operationalErrorFields } from '@/lib/security/operational-log';

const COEXISTENCE_FIELDS = new Set([
  'history',
  'smb_app_state_sync',
  'smb_message_echoes',
  'account_update',
]);

const CONTENT_TYPES = new Set([
  'text',
  'image',
  'document',
  'audio',
  'video',
  'location',
  'template',
  'interactive',
]);

type MessageSource = 'whatsapp_business_app' | 'coexistence_history';

interface ConfigRow {
  id: string;
  account_id: string;
  user_id: string;
  phone_number_id: string;
  waba_id: string | null;
}

interface ImportedMessage {
  id?: unknown;
  from?: unknown;
  to?: unknown;
  timestamp?: unknown;
  type?: unknown;
  text?: { body?: unknown };
  image?: { caption?: unknown };
  video?: { caption?: unknown };
  document?: { caption?: unknown; filename?: unknown };
  location?: {
    latitude?: unknown;
    longitude?: unknown;
    name?: unknown;
    address?: unknown;
  };
  button?: { text?: unknown };
  interactive?: {
    button_reply?: { title?: unknown };
    list_reply?: { title?: unknown };
  };
  history_context?: { status?: unknown };
}

interface CoexistenceValue {
  metadata?: { phone_number_id?: unknown; display_phone_number?: unknown };
  message_echoes?: unknown;
  history?: unknown;
  state_sync?: unknown;
  event?: unknown;
  waba_info?: { waba_id?: unknown };
  disconnection_info?: { reason?: unknown; initiated_by?: unknown };
}

export interface CoexistenceWebhookChange {
  field: string;
  value: unknown;
}

export function isCoexistenceWebhookField(field: string): boolean {
  return COEXISTENCE_FIELDS.has(field);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeString(value: unknown, max = 240): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

async function resolveConfigByPhone(
  db: SupabaseClient,
  phoneNumberId: unknown
): Promise<ConfigRow | null> {
  if (typeof phoneNumberId !== 'string' || !/^\d{5,30}$/.test(phoneNumberId)) {
    return null;
  }
  const { data, error } = await db
    .from('whatsapp_config')
    .select('id, account_id, user_id, phone_number_id, waba_id')
    .eq('phone_number_id', phoneNumberId)
    .eq('connection_mode', 'coexistence');
  if (error || !data || data.length !== 1) return null;
  return data[0] as ConfigRow;
}

async function findOrCreateSyncedContact(
  db: SupabaseClient,
  config: ConfigRow,
  rawPhone: string,
  name: string | null
) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;
  const existing = await findExistingContact(db, config.account_id, phone);
  if (existing) return existing;

  const { data, error } = await db
    .from('contacts')
    .insert({
      account_id: config.account_id,
      user_id: config.user_id,
      phone,
      name: name || phone,
    })
    .select('*')
    .single();
  if (!error && data) return data;
  if (isUniqueViolation(error)) {
    return findExistingContact(db, config.account_id, phone);
  }
  console.error(
    '[coexistence] contact persistence failed:',
    operationalErrorFields(error)
  );
  return null;
}

async function findOrCreateSyncedConversation(
  db: SupabaseClient,
  config: ConfigRow,
  contactId: string
) {
  const { data: existing, error: readError } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', config.account_id)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (readError) return null;
  if (existing?.[0]) return existing[0] as { id: string };

  const { data, error } = await db
    .from('conversations')
    .insert({
      account_id: config.account_id,
      user_id: config.user_id,
      contact_id: contactId,
    })
    .select('id')
    .single();
  if (!error && data) return data as { id: string };
  if (isUniqueViolation(error)) {
    const { data: raced } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', config.account_id)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1);
    return (raced?.[0] as { id: string } | undefined) ?? null;
  }
  console.error(
    '[coexistence] conversation persistence failed:',
    operationalErrorFields(error)
  );
  return null;
}

function importedContent(message: ImportedMessage) {
  const rawType = typeof message.type === 'string' ? message.type : 'text';
  const contentType = CONTENT_TYPES.has(rawType)
    ? rawType
    : rawType === 'sticker'
      ? 'image'
      : rawType === 'button'
        ? 'interactive'
        : 'text';
  let contentText: string | null = null;
  if (rawType === 'text') contentText = safeString(message.text?.body);
  else if (rawType === 'image')
    contentText = safeString(message.image?.caption);
  else if (rawType === 'video')
    contentText = safeString(message.video?.caption);
  else if (rawType === 'document') {
    contentText =
      safeString(message.document?.caption) ??
      safeString(message.document?.filename);
  } else if (rawType === 'button')
    contentText = safeString(message.button?.text);
  else if (rawType === 'interactive') {
    contentText =
      safeString(message.interactive?.button_reply?.title) ??
      safeString(message.interactive?.list_reply?.title);
  } else if (rawType === 'location' && message.location) {
    contentText = [
      safeString(message.location.name),
      safeString(message.location.address),
      typeof message.location.latitude === 'number' &&
      typeof message.location.longitude === 'number'
        ? `${message.location.latitude},${message.location.longitude}`
        : null,
    ]
      .filter(Boolean)
      .join(' - ');
  }
  return {
    contentType,
    contentText: contentText || `[${rawType}]`,
  };
}

function importedStatus(message: ImportedMessage) {
  const status = message.history_context?.status;
  return typeof status === 'string' &&
    ['sent', 'delivered', 'read', 'failed'].includes(status)
    ? status
    : 'sent';
}

async function persistImportedMessage(args: {
  db: SupabaseClient;
  config: ConfigRow;
  contactPhone: string;
  contactName?: string | null;
  message: ImportedMessage;
  senderType: 'customer' | 'agent';
  source: MessageSource;
  updateConversationSummary: boolean;
}) {
  const { db, config, message } = args;
  const messageId = safeString(message.id, 512);
  const timestamp = safeString(message.timestamp, 32);
  if (!messageId || !timestamp || !/^\d+$/.test(timestamp)) return false;
  const contact = await findOrCreateSyncedContact(
    db,
    config,
    args.contactPhone,
    args.contactName ?? null
  );
  if (!contact) return false;
  const conversation = await findOrCreateSyncedConversation(
    db,
    config,
    contact.id
  );
  if (!conversation) return false;

  const storedMessageId = messageId.slice(-8);
  const { data: duplicate } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversation.id)
    .eq('message_id', storedMessageId)
    .maybeSingle();
  if (duplicate) return false;

  const { contentType, contentText } = importedContent(message);
  const createdAt = new Date(Number(timestamp) * 1000);
  if (!Number.isFinite(createdAt.getTime())) return false;
  const { data: inserted, error } = await db
    .from('messages')
    .upsert(
      {
        account_id: config.account_id,
        conversation_id: conversation.id,
        sender_type: args.senderType,
        content_type: contentType,
        content_text: contentText,
        message_id: storedMessageId,
        status: importedStatus(message),
        source: args.source,
        created_at: createdAt.toISOString(),
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true }
    )
    .select('id');
  if (error || !inserted?.length) return false;

  if (args.updateConversationSummary) {
    await db
      .from('conversations')
      .update({
        last_message_text: contentText,
        last_message_at: createdAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)
      .eq('account_id', config.account_id);
  }
  return true;
}

async function handleEchoes(
  db: SupabaseClient,
  config: ConfigRow,
  value: CoexistenceValue
) {
  if (!Array.isArray(value.message_echoes)) return;
  for (const raw of value.message_echoes) {
    const message = asRecord(raw) as ImportedMessage | null;
    if (!message || typeof message.to !== 'string') continue;
    await persistImportedMessage({
      db,
      config,
      contactPhone: message.to,
      message,
      senderType: 'agent',
      source: 'whatsapp_business_app',
      updateConversationSummary: true,
    });
  }
}

async function handleHistory(
  db: SupabaseClient,
  config: ConfigRow,
  value: CoexistenceValue
) {
  if (!Array.isArray(value.history)) return;
  let completed = false;
  for (const rawChunk of value.history) {
    const chunk = asRecord(rawChunk);
    if (!chunk) continue;
    const metadata = asRecord(chunk.metadata);
    if (metadata?.progress === 100 || metadata?.progress === '100')
      completed = true;
    if (!Array.isArray(chunk.threads)) continue;
    for (const rawThread of chunk.threads) {
      const thread = asRecord(rawThread);
      if (
        !thread ||
        typeof thread.id !== 'string' ||
        !Array.isArray(thread.messages)
      ) {
        continue;
      }
      const contactPhone = normalizePhone(thread.id);
      for (const rawMessage of thread.messages) {
        const message = asRecord(rawMessage) as ImportedMessage | null;
        if (!message) continue;
        const from =
          typeof message.from === 'string' ? normalizePhone(message.from) : '';
        await persistImportedMessage({
          db,
          config,
          contactPhone,
          message,
          senderType: from === contactPhone ? 'customer' : 'agent',
          source: 'coexistence_history',
          updateConversationSummary: false,
        });
      }
    }
  }
  if (completed) {
    await db
      .from('whatsapp_config')
      .update({
        history_sync_status: 'completed',
        history_sync_completed_at: new Date().toISOString(),
        history_sync_error: null,
      })
      .eq('id', config.id)
      .eq('account_id', config.account_id);
  }
}

async function handleAppState(
  db: SupabaseClient,
  config: ConfigRow,
  value: CoexistenceValue
) {
  if (!Array.isArray(value.state_sync)) return;
  for (const raw of value.state_sync) {
    const state = asRecord(raw);
    const contact = asRecord(state?.contact);
    if (
      !state ||
      state.type !== 'contact' ||
      state.action === 'delete' ||
      typeof contact?.phone_number !== 'string'
    ) {
      continue;
    }
    await findOrCreateSyncedContact(
      db,
      config,
      contact.phone_number,
      safeString(contact.full_name)
    );
  }
  await db
    .from('whatsapp_config')
    .update({
      app_state_sync_status: 'completed',
      app_state_sync_completed_at: new Date().toISOString(),
      app_state_sync_error: null,
    })
    .eq('id', config.id)
    .eq('account_id', config.account_id);
}

async function handleAccountUpdate(
  db: SupabaseClient,
  entryId: string,
  value: CoexistenceValue
) {
  if (value.event !== 'PARTNER_REMOVED') return;
  const wabaId =
    typeof value.waba_info?.waba_id === 'string'
      ? value.waba_info.waba_id
      : entryId;
  if (!/^\d{5,30}$/.test(wabaId)) return;
  await db
    .from('whatsapp_config')
    .update({
      status: 'disconnected',
      disconnected_at: new Date().toISOString(),
      disconnect_reason:
        safeString(value.disconnection_info?.reason, 120) ?? 'partner_removed',
      disconnect_initiated_by:
        safeString(value.disconnection_info?.initiated_by, 120) ?? 'meta',
      updated_at: new Date().toISOString(),
    })
    .eq('waba_id', wabaId)
    .eq('connection_mode', 'coexistence');
}

export async function handleCoexistenceWebhookChange(
  change: CoexistenceWebhookChange,
  entryId: string,
  db: SupabaseClient
) {
  if (!isCoexistenceWebhookField(change.field)) return;
  const value = (asRecord(change.value) ?? {}) as CoexistenceValue;
  if (change.field === 'account_update') {
    await handleAccountUpdate(db, entryId, value);
    return;
  }
  const config = await resolveConfigByPhone(
    db,
    value.metadata?.phone_number_id
  );
  if (!config) {
    console.warn(
      '[coexistence] event ignored: no unique validated phone mapping',
      {
        field: change.field,
        phone_number_id_present:
          typeof value.metadata?.phone_number_id === 'string',
      }
    );
    return;
  }
  if (change.field === 'smb_message_echoes')
    await handleEchoes(db, config, value);
  else if (change.field === 'history') await handleHistory(db, config, value);
  else if (change.field === 'smb_app_state_sync')
    await handleAppState(db, config, value);
}
