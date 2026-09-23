import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  accountId: 'account-A',
  userId: 'admin-A',
  supabase: { marker: 'account-A-client' },
  requireRole: vi.fn(),
  resolveConversationByPhone: vi.fn(),
  sendMessageToConversation: vi.fn(),
}));

vi.mock('@/lib/auth/account', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/auth/account')>(
      '@/lib/auth/account'
    );
  return {
    ...actual,
    requireRole: h.requireRole,
  };
});

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { send: { limit: 60, windowMs: 60_000 } },
  checkRateLimit: vi.fn(() => ({ success: true })),
  rateLimitResponse: vi.fn(),
}));

vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: h.resolveConversationByPhone,
}));

vi.mock('@/lib/whatsapp/send-message', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/whatsapp/send-message')
  >('@/lib/whatsapp/send-message');
  return {
    ...actual,
    sendMessageToConversation: h.sendMessageToConversation,
  };
});

import { ForbiddenError } from '@/lib/auth/account';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import { POST } from './route';

function request(phone: unknown, extra: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/whatsapp/test-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, ...extra }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue({
    supabase: h.supabase,
    accountId: h.accountId,
    userId: h.userId,
    role: 'admin',
  });
  h.resolveConversationByPhone.mockResolvedValue({
    conversationId: 'conversation-A',
    contactId: 'contact-A',
    contactCreated: false,
  });
  h.sendMessageToConversation.mockResolvedValue({
    messageId: 'message-A',
    whatsappMessageId: 'wamid.real-from-meta',
  });
});

describe('POST /api/whatsapp/test-message', () => {
  it('sends hello_world in en_US through the existing conversation pipeline', async () => {
    const response = await POST(
      request('+55 (85) 99999-0000', { account_id: 'account-attacker' })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      message_id: 'message-A',
      whatsapp_message_id: 'wamid.real-from-meta',
      conversation_id: 'conversation-A',
    });
    expect(h.requireRole).toHaveBeenCalledWith('admin');
    expect(h.resolveConversationByPhone).toHaveBeenCalledWith(
      h.supabase,
      'account-A',
      '+55 (85) 99999-0000'
    );
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      h.supabase,
      'account-A',
      expect.objectContaining({
        conversationId: 'conversation-A',
        messageType: 'template',
        templateName: 'hello_world',
        templateLanguage: 'en_US',
        contentText: expect.stringContaining('Hello World'),
      })
    );
  });

  it('rejects an invalid phone without resolving or sending', async () => {
    h.resolveConversationByPhone.mockRejectedValue(
      new SendMessageError('bad_request', 'raw validation detail', 400)
    );

    const response = await POST(request('invalid'));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toMatch(/número de WhatsApp válido/i);
    expect(json.error).not.toContain('raw validation detail');
    expect(h.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('returns a safe error when the current account has no WhatsApp config', async () => {
    h.resolveConversationByPhone.mockRejectedValue(
      new SendMessageError(
        'whatsapp_not_configured',
        'internal configuration detail',
        400
      )
    );

    const response = await POST(request('+14155550123'));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toMatch(/conecte o WhatsApp/i);
    expect(json.error).not.toContain('internal configuration detail');
    expect(h.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('does not trust an account_id supplied by the client', async () => {
    await POST(request('+14155550123', { account_id: 'account-B' }));

    expect(h.resolveConversationByPhone).toHaveBeenCalledWith(
      h.supabase,
      'account-A',
      '+14155550123'
    );
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      h.supabase,
      'account-A',
      expect.any(Object)
    );
  });

  it('requires an administrator before touching a conversation or Meta', async () => {
    h.requireRole.mockRejectedValue(new ForbiddenError());

    const response = await POST(request('+14155550123'));

    expect(response.status).toBe(403);
    expect(h.resolveConversationByPhone).not.toHaveBeenCalled();
    expect(h.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('does not claim success or leak Meta details when Meta rejects the send', async () => {
    h.sendMessageToConversation.mockRejectedValue(
      new SendMessageError(
        'meta_error',
        'Meta API error: sensitive upstream diagnostics',
        502
      )
    );

    const response = await POST(request('+14155550123'));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json.error).toMatch(/Meta não aceitou/i);
    expect(json.error).not.toContain('sensitive upstream diagnostics');
  });
});
