import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Shared, hoisted state the module mocks close over. Reset per test.
const h = vi.hoisted(() => ({
  runAutomationsForTrigger: vi.fn(),
  dispatchInboundToFlows: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  captureMetaAdAttribution: vi.fn(),
  createMetaEnrichmentRepository: vi.fn(),
  enrichMetaAdAttribution: vi.fn(),
  state: {
    // Result the message upsert's .select() resolves to. A genuine insert
    // returns the row; a replayed delivery conflicts and returns [].
    messageUpsertResult: [{ id: 'msg-1' }] as { id: string }[],
    priorCustomerMsgCount: 0,
    /** Row `lookupInternalIdByMetaId` resolves for a `context.id`. */
    replyContextParent: null as { id: string } | null,
    conversation: { id: 'conv-1', unread_count: 0, account_id: 'acc-1' },
    upsertCalls: [] as { row: Record<string, unknown>; options: unknown }[],
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
    afterCallbacks: [] as (() => Promise<void> | void)[],
    automationStarted: 0,
    automationCompleted: 0,
    /** whatsapp_config.mirror_inbound_media for the matched row (#466). */
    mirrorInboundMedia: true as boolean | undefined,
    /** Objects the inbound-media mirror pushed into chat-media. */
    storageUploads: [] as {
      bucket: string
      path: string
      options: { contentType?: string }
    }[],
    /** Error the next storage upload resolves with, if any. */
    storageUploadError: null as { message: string } | null,
    statusMessageRow: null as {
      conversation_id: string
      conversations: { account_id: string }
    } | null,
    statusRecipientRow: null as { id: string; status: string } | null,
    phoneAccounts: null as Record<string, string> | null,
    storedStatuses: [] as {accountId: string; messageId: string; status: string}[],
    messageStatusUpdates: [] as { status: string; messageId: string; accountId: string }[],
  },
}))

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.state.afterCallbacks.push(cb)
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      switch (table) {
        case 'whatsapp_config':
          return {
            select: () => ({
              eq: (_column: string, phone: string) =>
                Promise.resolve({
                  data: h.state.phoneAccounts && !h.state.phoneAccounts[phone] ? [] : [
                    {
                      id: 'whatsapp-config-1',
                      account_id: h.state.phoneAccounts?.[phone] ?? 'acc-1',
                      user_id: 'user-1',
                      access_token: 'enc',
                      waba_id: 'waba-1',
                      phone_number_id: 'pn-1',
                      mirror_inbound_media: h.state.mirrorInboundMedia,
                    },
                  ],
                  error: null,
                }),
            }),
          }
        case 'conversations':
          // findOrCreateConversation: select().eq().eq().order().limit()
          return {
            select: () => ({
              eq: (_column: string, accountId: string) => ({
                eq: () => ({
                  order: () => ({
                    limit: () =>
                      Promise.resolve({
                        data: [h.state.phoneAccounts ? { ...h.state.conversation, id: `conv-${accountId}`, account_id: accountId } : h.state.conversation],
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          }
        case 'broadcast_recipients':
          // flagBroadcastReplyIfAny: select().eq().eq().in().order().limit()
          return {
            select: (columns: string) =>
              columns === 'id, status'
                ? {
                    eq: () => ({
                      eq: () => ({ maybeSingle: () => Promise.resolve({data:h.state.statusRecipientRow,error:null}) }),
                      maybeSingle: () =>
                        Promise.resolve({
                          data: h.state.statusRecipientRow,
                          error: null,
                        }),
                    }),
                  }
                : ({
                    eq: () => ({
                      eq: () => ({
                        in: () => ({
                          order: () => ({
                            limit: () =>
                              Promise.resolve({ data: [], error: null }),
                          }),
                        }),
                      }),
                    }),
                  } as never),
          }
        case 'messages':
          return {
            // Two different chains land here, told apart by the count
            // option: the prior-message count (head request) and the
            // reply-context parent lookup.
            select: (_columns: string, options?: { head?: boolean }) =>
              options?.head
                ? // priorCustomerMsgCount: select('id',{count,head}).eq().eq()
                  {
                    eq: () => ({
                      eq: () =>
                        Promise.resolve({
                          count: h.state.priorCustomerMsgCount,
                          error: null,
                        }),
                    }),
                  }
                : _columns === 'conversation_id, conversations(account_id)'
                  ? {
                      eq: () => ({
                        eq: () => ({limit:()=>({maybeSingle:()=>Promise.resolve({data:h.state.statusMessageRow,error:null})})}),
                        limit: () => ({
                          maybeSingle: () =>
                            Promise.resolve({
                              data: h.state.statusMessageRow,
                              error: null,
                            }),
                        }),
                      }),
                    }
                : // lookupInternalIdByMetaId: select('id').eq().eq().maybeSingle()
                  {
                    eq: () => ({
                      eq: () => ({
                        maybeSingle: () =>
                          Promise.resolve({
                            data: h.state.replyContextParent,
                            error: null,
                          }),
                      }),
                    }),
                  },
            update: (row: { status: string }) => ({
              eq: (_column: string, messageId: string) => {
                return {eq: (_column:string,accountId:string) => {
                  h.state.messageStatusUpdates.push({status:row.status,messageId,accountId});
                  for (const stored of h.state.storedStatuses) if(stored.accountId===accountId && stored.messageId===messageId) stored.status=row.status;
                  return Promise.resolve({error:null});
                }}
              },
            }),
            // Idempotent insert: upsert(...).select('id')
            upsert: (row: Record<string, unknown>, options: unknown) => {
              h.state.upsertCalls.push({ row, options })
              return {
                select: () =>
                  Promise.resolve({
                    data: h.state.messageUpsertResult,
                    error: null,
                  }),
              }
            },
          }
        default:
          throw new Error(`unexpected table: ${table}`)
      }
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: null, error: null })
    },
    // Service-role Storage, used by the inbound-media mirror (#466).
    storage: {
      from(bucket: string) {
        return {
          upload: (
            path: string,
            _body: unknown,
            options: { contentType?: string },
          ) => {
            h.state.storageUploads.push({ bucket, path, options })
            return Promise.resolve({ error: h.state.storageUploadError })
          },
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://cdn.test/${bucket}/${path}` },
          }),
        }
      },
    },
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'plain-token',
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}))
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn(async (_db: unknown, accountId: string) => ({
    id: h.state.phoneAccounts ? `contact-${accountId}` : 'contact-1',
    name: 'Ada',
    phone: '15551230000',
  })),
  isUniqueViolation: () => false,
}))
vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: () => true,
}))
vi.mock('@/lib/whatsapp/template-webhook', () => ({
  isTemplateWebhookField: () => false,
  handleTemplateWebhookChange: vi.fn(),
}))
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}))
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: h.dispatchInboundToFlows,
}))
vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: h.dispatchInboundToAiReply,
}))
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: h.dispatchWebhookEvent,
}))
vi.mock('@/lib/meta-conversions/attribution', () => ({
  captureMetaAdAttribution: h.captureMetaAdAttribution,
  isCtwaReferral: (referral?: { source_type?: string; ctwa_clid?: string }) =>
    referral?.source_type === 'ad' && Boolean(referral.ctwa_clid?.trim()),
  maskCtwaClid: (value: string) =>
    value.length <= 6 ? '***' : `${value.slice(0, 3)}...${value.slice(-3)}`,
}))
vi.mock('@/lib/meta-conversions/enrichment', () => ({
  createMetaEnrichmentRepository: h.createMetaEnrichmentRepository,
  enrichMetaAdAttribution: h.enrichMetaAdAttribution,
}))

import { POST } from './route'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'

const mockGetMediaUrl = vi.mocked(getMediaUrl)
const mockDownloadMedia = vi.mocked(downloadMedia)

const TEXT_MESSAGE = {
  id: 'wamid.TEST1',
  from: '15551230000',
  timestamp: '1700000000',
  type: 'text',
  text: { body: 'hello' },
}

function inboundRequest(message: Record<string, unknown> = TEXT_MESSAGE) {
  const body = {
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'pn-1' },
              contacts: [{ wa_id: '15551230000', profile: { name: 'Ada' } }],
              messages: [message],
            },
          },
        ],
      },
    ],
  }
  return {
    text: async () => JSON.stringify(body),
    headers: { get: () => 'sha256=stub' },
  } as unknown as Request
}

async function runWebhook(message?: Record<string, unknown>) {
  const res = await POST(inboundRequest(message))
  // Drain the after() callback exactly as the runtime would.
  for (const cb of h.state.afterCallbacks) await cb()
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.messageUpsertResult = [{ id: 'msg-1' }]
  h.state.priorCustomerMsgCount = 0
  h.state.replyContextParent = null
  h.state.conversation = { id: 'conv-1', unread_count: 0, account_id: 'acc-1' }
  h.state.upsertCalls = []
  h.state.rpcCalls = []
  h.state.afterCallbacks = []
  h.state.automationStarted = 0
  h.state.automationCompleted = 0
  h.state.mirrorInboundMedia = true
  h.state.storageUploads = []
  h.state.storageUploadError = null
  h.state.statusMessageRow = null
  h.state.statusRecipientRow = null
  h.state.messageStatusUpdates = []
  h.state.phoneAccounts = null
  h.state.storedStatuses = []
  mockGetMediaUrl.mockResolvedValue({
    url: 'https://lookaside.fbsbx.com/whatsapp/abc',
    mimeType: 'image/jpeg',
    fileSize: 2048,
  })
  mockDownloadMedia.mockResolvedValue({
    buffer: Buffer.alloc(2048),
    contentType: 'image/jpeg',
  })
  h.dispatchInboundToFlows.mockResolvedValue({ consumed: false })
  h.dispatchInboundToAiReply.mockResolvedValue(undefined)
  h.dispatchWebhookEvent.mockResolvedValue(undefined)
  h.captureMetaAdAttribution.mockResolvedValue({
    captured: false,
    reason: 'not_ctwa',
  })
  h.createMetaEnrichmentRepository.mockReturnValue({})
  h.enrichMetaAdAttribution.mockResolvedValue({ status: 'enriched' })
  h.runAutomationsForTrigger.mockImplementation(() => {
    h.state.automationStarted++
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        h.state.automationCompleted++
        resolve()
      }, 0)
    })
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('WhatsApp webhook: unmatched delivery-status observability', () => {
  function statusRequest(status: Record<string, unknown>) {
    return {
      text: async () =>
        JSON.stringify({
          entry: [
            {
              changes: [
                {
                  field: 'messages',
                  value: {
                    metadata: { phone_number_id: '108261528923943' },
                    statuses: [status],
                  },
                },
              ],
            },
          ],
        }),
      headers: { get: () => 'sha256=stub' },
    } as unknown as Request
  }

  async function runStatusWebhook(status: Record<string, unknown>) {
    const res = await POST(statusRequest(status))
    for (const cb of h.state.afterCallbacks) await cb()
    return res
  }

  it('logs a failed unmatched status with only sanitized diagnostic fields', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fullRecipient = '5585997710664'
    const fullMessageId = 'wamid.UNMATCHED-12345678'
    vi.stubEnv('META_APP_SECRET', 'ACTUAL_META_APP_SECRET_VALUE')

    const response = await runStatusWebhook({
      id: fullMessageId,
      status: 'failed',
      timestamp: '1789390800',
      recipient_id: fullRecipient,
      errors: [
        {
          code: 131026,
          title: 'Message undeliverable',
          message: 'Authorization: Bearer NEVER_LOG_THIS_TOKEN',
          error_data: {
            details:
              'Recipient unavailable; ACTUAL_META_APP_SECRET_VALUE app_secret=NEVER_LOG_THIS_SECRET',
          },
        },
      ],
    })

    expect(response).toEqual({ body: { status: 'received' }, init: { status: 200 } })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'whatsapp_unmatched_status',
        status: 'failed',
        timestamp: '1789390800',
        message_id: '12345678',
        recipient_digit_count: 13,
        recipient_last4: '0664',
        phone_number_id: '108261528923943',
        errors: [
          {
            code: 131026,
            title: 'Message undeliverable',
            message: '[REDACTED]',
            error_data: {
              details:
                '[REDACTED]',
            },
          },
        ],
      })
    )

    const serializedLog = JSON.stringify(warnSpy.mock.calls)
    expect(serializedLog).toContain('131026')
    expect(serializedLog).toContain('Message undeliverable')
    expect(serializedLog).toContain('[REDACTED]')
    expect(serializedLog).not.toContain(fullRecipient)
    expect(serializedLog).not.toContain(fullMessageId)
    expect(serializedLog).not.toContain('ACTUAL_META_APP_SECRET_VALUE')
    expect(serializedLog).not.toContain('NEVER_LOG_THIS_TOKEN')
    expect(serializedLog).not.toContain('NEVER_LOG_THIS_SECRET')
  })

  it('logs a delivered unmatched status', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await runStatusWebhook({
      id: 'wamid.UNMATCHED-87654321',
      status: 'delivered',
      timestamp: '1789390860',
      recipient_id: '5585997710664',
    })

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'whatsapp_unmatched_status',
        status: 'delivered',
        message_id: '87654321',
      })
    )
  })

  it('keeps correlated message status behavior and emits no unmatched log', async () => {
    h.state.statusMessageRow = {
      conversation_id: 'conv-1',
      conversations: { account_id: 'acc-1' },
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await runStatusWebhook({
      id: 'wamid.CORRELATED-12345678',
      status: 'delivered',
      timestamp: '1789390860',
      recipient_id: '5585997710664',
    })

    expect(h.state.messageStatusUpdates).toEqual([
      { status: 'delivered', messageId: 'wamid.CORRELATED-12345678', accountId: 'acc-1' },
    ])
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'acc-1',
      'message.status_updated',
      {
        whatsapp_message_id: 'wamid.CORRELATED-12345678',
        conversation_id: 'conv-1',
        status: 'delivered',
      }
    )
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('inbound webhook: idempotent insert (#367)', () => {
  it('a genuine first delivery persists once and fans out downstream', async () => {
    await runWebhook()

    // Inserted via upsert with the (conversation_id, message_id) conflict
    // target — not a bare insert.
    expect(h.state.upsertCalls).toHaveLength(1)
    expect(h.state.upsertCalls[0].options).toMatchObject({
      onConflict: 'conversation_id,message_id',
      ignoreDuplicates: true,
    })
    // Downstream side effects ran exactly once.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.dispatchInboundToFlows).toHaveBeenCalledTimes(1)
    expect(h.dispatchWebhookEvent).toHaveBeenCalledTimes(1)
  })

  it('a replayed delivery is a no-op: no unread bump, no fan-out', async () => {
    // Upsert hits the unique index and returns no row.
    h.state.messageUpsertResult = []

    await runWebhook()

    expect(h.state.upsertCalls).toHaveLength(1)
    // None of the downstream side effects fire on a replay.
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled()
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled()
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled()
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled()
  })
})

describe('inbound webhook: CTWA attribution', () => {
  const CTWA_MESSAGE = {
    ...TEXT_MESSAGE,
    id: 'wamid.CTWA1',
    referral: {
      source_type: 'ad',
      source_id: 'ad-123',
      ctwa_clid: 'TEST_ctwa-AbC123_xyz',
    },
  }

  it('does not delegate organic messages to attribution persistence', async () => {
    await runWebhook()

    expect(h.captureMetaAdAttribution).not.toHaveBeenCalled()
  })

  it('delegates capture with the resolved entities and connection snapshot', async () => {
    h.captureMetaAdAttribution.mockResolvedValueOnce({
      captured: true,
      attributionId: 'attribution-1',
    })
    await runWebhook(CTWA_MESSAGE)

    expect(h.captureMetaAdAttribution).toHaveBeenCalledWith(expect.anything(), {
      accountId: 'acc-1',
      contactId: 'contact-1',
      conversationId: 'conv-1',
      whatsappConfig: {
        id: 'whatsapp-config-1',
        waba_id: 'waba-1',
        phone_number_id: 'pn-1',
      },
      whatsappMessageId: 'wamid.CTWA1',
      whatsappMessageTimestamp: '1700000000',
      referral: CTWA_MESSAGE.referral,
    })
    expect(h.enrichMetaAdAttribution).toHaveBeenCalledWith({
      repository: {},
      accountId: 'acc-1',
      attributionId: 'attribution-1',
    })
    expect(h.dispatchWebhookEvent.mock.invocationCallOrder[0]).toBeLessThan(
      h.enrichMetaAdAttribution.mock.invocationCallOrder[0]
    )
  })

  it('attempts capture on a deduplicated message so replay can heal it', async () => {
    h.state.messageUpsertResult = []

    await runWebhook(CTWA_MESSAGE)

    expect(h.captureMetaAdAttribution).toHaveBeenCalledTimes(1)
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled()
  })

  it('keeps downstream processing alive and logs only masked/sanitized failure data', async () => {
    h.captureMetaAdAttribution.mockRejectedValueOnce({
      code: '08006',
      message: 'secret-token TEST_ctwa-AbC123_xyz',
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runWebhook(CTWA_MESSAGE)

    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.dispatchInboundToFlows).toHaveBeenCalledTimes(1)
    expect(h.dispatchWebhookEvent).toHaveBeenCalledTimes(1)
    const serializedLogs = JSON.stringify(errorSpy.mock.calls)
    expect(serializedLogs).toContain('[meta-conversions][attribution]')
    expect(serializedLogs).toContain('TES...xyz')
    expect(serializedLogs).toContain('08006')
    expect(serializedLogs).not.toContain('TEST_ctwa-AbC123_xyz')
    expect(serializedLogs).not.toContain('secret-token')
  })

  it('keeps all existing downstream work complete when automatic enrichment fails', async () => {
    h.captureMetaAdAttribution.mockResolvedValueOnce({
      captured: true,
      attributionId: 'attribution-1',
    })
    h.enrichMetaAdAttribution.mockRejectedValueOnce({
      code: '08006',
      message: 'EA_SECRET_TOKEN',
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runWebhook(CTWA_MESSAGE)

    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.dispatchInboundToFlows).toHaveBeenCalledTimes(1)
    expect(h.runAutomationsForTrigger).toHaveBeenCalled()
    expect(h.dispatchInboundToAiReply).toHaveBeenCalledTimes(1)
    expect(h.dispatchWebhookEvent).toHaveBeenCalledTimes(1)
    expect(h.enrichMetaAdAttribution).toHaveBeenCalledTimes(1)
    const serializedLogs = JSON.stringify(errorSpy.mock.calls)
    expect(serializedLogs).toContain('[meta-conversions][enrichment]')
    expect(serializedLogs).toContain('08006')
    expect(serializedLogs).not.toContain('EA_SECRET_TOKEN')
  })
})

describe('inbound webhook: atomic unread bump (#369)', () => {
  it('increments unread through the DB-side RPC, not a read-modify-write', async () => {
    await runWebhook()

    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.state.rpcCalls[0]).toMatchObject({
      name: 'bump_conversation_on_inbound',
      args: { p_conversation_id: 'conv-1' },
    })
  })
})

describe('inbound webhook: template quick-reply buttons (#478)', () => {
  // A customer tapping a QUICK_REPLY button on a broadcast template.
  // `context.id` points at the template message we sent — which the
  // broadcast path never wrote to `messages`, so the parent lookup
  // legitimately misses and the reply is stored unquoted.
  const templateButtonTap = {
    id: 'wamid.BTN1',
    from: '15551230000',
    timestamp: '1700000000',
    type: 'button',
    button: { text: 'Yes, interested', payload: 'YES_INTERESTED' },
    context: { id: 'wamid.BROADCAST1' },
  }

  it('stores the tap as an interactive reply, not an unsupported message', async () => {
    await runWebhook(templateButtonTap)

    expect(h.state.upsertCalls).toHaveLength(1)
    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: 'interactive',
      content_text: 'Yes, interested',
      interactive_reply_id: 'YES_INTERESTED',
      reply_to_message_id: null,
    })
  })

  it('routes the tap to flows and fires the interactive_reply trigger', async () => {
    await runWebhook(templateButtonTap)

    expect(h.dispatchInboundToFlows).toHaveBeenCalledWith(
      expect.objectContaining({
        message: {
          kind: 'interactive_reply',
          reply_id: 'YES_INTERESTED',
          reply_title: 'Yes, interested',
          meta_message_id: 'wamid.BTN1',
        },
      }),
    )
    const triggers = h.runAutomationsForTrigger.mock.calls.map(
      (call) => (call[0] as { triggerType: string }).triggerType,
    )
    expect(triggers).toContain('interactive_reply')
    // The AI auto-reply must stay out of it — a button tap is not a
    // free-text question.
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled()
  })

  it('falls back to the label when the template button carries no payload', async () => {
    await runWebhook({
      ...templateButtonTap,
      button: { text: 'Track my order' },
    })

    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: 'interactive',
      content_text: 'Track my order',
      interactive_reply_id: 'Track my order',
    })
  })
})

describe('inbound webhook: inbound media is mirrored (#466)', () => {
  const IMAGE_MESSAGE = {
    id: 'wamid.IMG1',
    from: '15551230000',
    timestamp: '1700000000',
    type: 'image',
    image: { id: '1234567890123456', mime_type: 'image/jpeg', caption: 'hi' },
  }

  it('stores a durable bucket URL instead of the expiring proxy path', async () => {
    await runWebhook(IMAGE_MESSAGE)

    expect(h.state.storageUploads).toHaveLength(1)
    expect(h.state.storageUploads[0].bucket).toBe('chat-media')
    expect(h.state.storageUploads[0].path).toBe(
      'account-acc-1/inbound/1234567890123456-image-1700000000.jpg',
    )
    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url:
        '/api/storage/chat-media/account-acc-1/inbound/1234567890123456-image-1700000000.jpg',
      // Meta's MIME type used to be discarded outright (`void mediaType`).
      media_type: 'image/jpeg',
    })
  })

  it('falls back to the proxy URL when the upload is refused', async () => {
    h.state.storageUploadError = { message: 'mime type not supported' }

    await runWebhook(IMAGE_MESSAGE)

    // The message still lands, and it still lands with a usable URL —
    // the mirror failing must never cost us the message.
    expect(h.state.upsertCalls).toHaveLength(1)
    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/1234567890123456',
      media_type: 'image/jpeg',
    })
  })

  it('falls back to the proxy URL when the download from Meta throws', async () => {
    mockDownloadMedia.mockRejectedValueOnce(new Error('Media download failed: 404'))

    await runWebhook(IMAGE_MESSAGE)

    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/1234567890123456',
    })
  })

  it('skips media larger than the bucket accepts, without downloading it', async () => {
    mockGetMediaUrl.mockResolvedValue({
      url: 'https://lookaside.fbsbx.com/whatsapp/big',
      mimeType: 'application/pdf',
      fileSize: 40 * 1024 * 1024,
    })

    await runWebhook({
      id: 'wamid.DOC1',
      from: '15551230000',
      timestamp: '1700000000',
      type: 'document',
      document: {
        id: '999',
        mime_type: 'application/pdf',
        filename: 'huge.pdf',
      },
    })

    expect(mockDownloadMedia).not.toHaveBeenCalled()
    expect(h.state.storageUploads).toHaveLength(0)
    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/999',
      media_type: 'application/pdf',
    })
  })

  it("names the object after a document's own filename", async () => {
    mockGetMediaUrl.mockResolvedValue({
      url: 'https://lookaside.fbsbx.com/whatsapp/doc',
      mimeType: 'application/pdf',
      fileSize: 4096,
    })
    mockDownloadMedia.mockResolvedValue({
      buffer: Buffer.alloc(4096),
      contentType: 'application/pdf',
    })

    await runWebhook({
      id: 'wamid.DOC2',
      from: '15551230000',
      timestamp: '1700000000',
      type: 'document',
      document: {
        id: '1234567890123456',
        mime_type: 'application/pdf',
        filename: 'invoice.pdf',
        caption: 'have a look',
      },
    })

    expect(h.state.storageUploads[0].path).toBe(
      'account-acc-1/inbound/1234567890123456-invoice.pdf',
    )
  })

  it('does not mirror when the account has opted out', async () => {
    h.state.mirrorInboundMedia = false

    await runWebhook(IMAGE_MESSAGE)

    expect(mockDownloadMedia).not.toHaveBeenCalled()
    expect(h.state.storageUploads).toHaveLength(0)
    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/1234567890123456',
      // Still recorded — the MIME type costs nothing and makes the
      // download name right even for proxied media.
      media_type: 'image/jpeg',
    })
  })

  it('mirrors when the column is absent, e.g. a row read before migration 039', async () => {
    h.state.mirrorInboundMedia = undefined

    await runWebhook(IMAGE_MESSAGE)

    expect(h.state.storageUploads).toHaveLength(1)
  })

  it('leaves text messages alone', async () => {
    await runWebhook()

    expect(mockGetMediaUrl).not.toHaveBeenCalled()
    expect(h.state.storageUploads).toHaveLength(0)
    expect(h.state.upsertCalls[0].row).toMatchObject({ media_type: null })
  })
})

describe('inbound webhook: after() awaits automations (#368)', () => {
  it('every triggered automation settles before the after() callback resolves', async () => {
    await runWebhook()

    // first_inbound_message + new_message_received + keyword_match.
    expect(h.state.automationStarted).toBe(3)
    // If the dispatches were fire-and-forget, completed would still be 0
    // here — the callback would have resolved before the timers fired.
    expect(h.state.automationCompleted).toBe(3)
  })
})

describe('WhatsApp multi-tenant routing (21G)', () => {
  async function receive(values: Record<string, unknown>[]) {
    await POST({text: async () => JSON.stringify({entry: values.map(value => ({
      changes:[{field:'messages',value}]
    }))}), headers:{get:()=> 'sha256=stub'}} as unknown as Request)
    for (const callback of h.state.afterCallbacks) await callback()
  }
  it('status for Phone A changes only A, even when B has the same external ID', async () => {
    h.state.phoneAccounts={'phone-A':'account-A','phone-B':'account-B'}
    h.state.storedStatuses=[
      {accountId:'account-A',messageId:'same-wamid',status:'sent'},
      {accountId:'account-B',messageId:'same-wamid',status:'sent'},
    ]
    await receive([{metadata:{phone_number_id:'phone-A'},statuses:[
      {id:'same-wamid',status:'delivered',timestamp:'1700000000',recipient_id:'15550000001'}
    ]}])
    expect(h.state.storedStatuses.map(row=>row.status)).toEqual(['delivered','sent'])
    expect(h.state.messageStatusUpdates).toEqual([
      {accountId:'account-A',messageId:'same-wamid',status:'delivered'}
    ])
  })
  it('unknown phone fails closed without a default tenant or mutation', async () => {
    h.state.phoneAccounts={'phone-A':'account-A','phone-B':'account-B'}
    await receive([{metadata:{phone_number_id:'unknown'},statuses:[
      {id:'same-wamid',status:'read',timestamp:'1700000000'}
    ]}])
    expect(h.state.messageStatusUpdates).toEqual([])
    expect(h.state.upsertCalls).toEqual([])
  })
  it('inbound Phone A and Phone B in one webhook keep independent accounts', async () => {
    h.state.phoneAccounts={'phone-A':'account-A','phone-B':'account-B'}
    await receive(['A','B'].map(letter=>({
      metadata:{phone_number_id:`phone-${letter}`},
      contacts:[{wa_id:'15550000001',profile:{name:'Ada'}}],
      messages:[{...TEXT_MESSAGE,id:`wamid.synthetic-${letter}`}]
    })))
    expect(h.state.upsertCalls.map(({row})=>({
      account:row.account_id,conversation:row.conversation_id
    }))).toEqual([
      {account:'account-A',conversation:'conv-account-A'},
      {account:'account-B',conversation:'conv-account-B'}
    ])
  })
})
