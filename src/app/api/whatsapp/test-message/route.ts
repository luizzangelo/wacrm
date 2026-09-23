import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { operationalErrorFields } from '@/lib/security/operational-log';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import {
  SendMessageError,
  sendMessageToConversation,
} from '@/lib/whatsapp/send-message';

const HELLO_WORLD_DISPLAY_TEXT =
  'Hello World\n\nWelcome and congratulations! This message demonstrates your ability to send a message notification from the WhatsApp Business Platform Cloud API.';

function publicSendError(error: SendMessageError): string {
  switch (error.code) {
    case 'bad_request':
      return 'Informe um número de WhatsApp válido, incluindo o código do país.';
    case 'whatsapp_not_configured':
      return 'Conecte o WhatsApp antes de enviar a mensagem de teste.';
    case 'not_found':
      return 'Não foi possível localizar a conversa desta conta.';
    case 'meta_error':
      return 'A Meta não aceitou a mensagem de teste. Verifique o destinatário e tente novamente.';
    default:
      return 'Não foi possível enviar a mensagem de teste.';
  }
}

/**
 * Sends Meta's official hello_world template through the same account-scoped
 * pipeline used by the Inbox. The client supplies only the destination phone;
 * account, credentials, template identity and persisted conversation are all
 * resolved on the server.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(
      `whatsapp-test-message:${userId}`,
      RATE_LIMITS.send
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      phone?: unknown;
    } | null;
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';

    if (!phone) {
      return NextResponse.json(
        {
          error:
            'Informe um número de WhatsApp válido, incluindo o código do país.',
        },
        { status: 400 }
      );
    }

    try {
      const resolved = await resolveConversationByPhone(
        supabase,
        accountId,
        phone
      );
      const result = await sendMessageToConversation(supabase, accountId, {
        conversationId: resolved.conversationId,
        messageType: 'template',
        templateName: 'hello_world',
        templateLanguage: 'en_US',
        contentText: HELLO_WORLD_DISPLAY_TEXT,
      });

      return NextResponse.json({
        success: true,
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
        conversation_id: resolved.conversationId,
      });
    } catch (error) {
      if (error instanceof SendMessageError) {
        return NextResponse.json(
          { error: publicSendError(error) },
          { status: error.status }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error(
      '[whatsapp-test-message] request failed:',
      operationalErrorFields(error)
    );
    return toErrorResponse(error);
  }
}
