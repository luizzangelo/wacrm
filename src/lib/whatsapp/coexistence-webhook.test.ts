import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  configRows: [
    {
      id: 'config-A',
      account_id: 'account-A',
      user_id: 'user-A',
      phone_number_id: '108261528923943',
      waba_id: '2295585011204142',
    },
  ] as Array<Record<string, unknown>>,
  existingContact: {
    id: 'contact-A',
    phone: '5585999990000',
    name: 'Manual CRM name',
  } as Record<string, unknown> | null,
  duplicate: null as Record<string, unknown> | null,
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; row: Record<string, unknown> }>,
  upserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
}));

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: () => Promise.resolve(h.existingContact),
  isUniqueViolation: (error: { code?: string }) => error?.code === '23505',
}));

function query(table: string) {
  let result: { data: unknown; error: unknown } = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  const self = chain as typeof chain & PromiseLike<typeof result>;
  for (const method of ['eq', 'order', 'limit']) chain[method] = () => self;
  chain.select = (columns?: string) => {
    if (table === 'whatsapp_config' && columns?.includes('account_id')) {
      result = { data: h.configRows, error: null };
    } else if (table === 'conversations') {
      result = { data: [{ id: 'conversation-A' }], error: null };
    }
    return self;
  };
  chain.insert = (row: Record<string, unknown>) => {
    h.inserts.push({ table, row });
    result = {
      data:
        table === 'contacts'
          ? { id: 'contact-new', ...row }
          : { id: 'conversation-new' },
      error: null,
    };
    return self;
  };
  chain.upsert = (row: Record<string, unknown>) => {
    h.upserts.push({ table, row });
    result = { data: [{ id: 'message-new' }], error: null };
    return self;
  };
  chain.update = (row: Record<string, unknown>) => {
    h.updates.push({ table, row });
    return self;
  };
  chain.maybeSingle = async () => ({ data: h.duplicate, error: null });
  chain.single = async () => result;
  self.then = (resolve, reject) =>
    Promise.resolve(result).then(resolve, reject);
  return self;
}

const db = { from: (table: string) => query(table) };

import { handleCoexistenceWebhookChange } from './coexistence-webhook';

beforeEach(() => {
  h.configRows = [
    {
      id: 'config-A',
      account_id: 'account-A',
      user_id: 'user-A',
      phone_number_id: '108261528923943',
      waba_id: '2295585011204142',
    },
  ];
  h.existingContact = {
    id: 'contact-A',
    phone: '5585999990000',
    name: 'Manual CRM name',
  };
  h.duplicate = null;
  h.inserts.length = 0;
  h.updates.length = 0;
  h.upserts.length = 0;
});

describe('coexistence webhook handlers', () => {
  it('stores a Business App echo as outbound without unread/automation paths', async () => {
    await handleCoexistenceWebhookChange(
      {
        field: 'smb_message_echoes',
        value: {
          metadata: { phone_number_id: '108261528923943' },
          message_echoes: [
            {
              from: '15550000000',
              to: '5585999990000',
              id: 'wamid.echo-00000001',
              timestamp: '1700000000',
              type: 'text',
              text: { body: 'Resposta pelo celular' },
            },
          ],
        },
      },
      '2295585011204142',
      db as never
    );
    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0]).toMatchObject({
      table: 'messages',
      row: {
        account_id: 'account-A',
        sender_type: 'agent',
        source: 'whatsapp_business_app',
        content_text: 'Resposta pelo celular',
        message_id: '00000001',
      },
    });
    expect(h.updates).toContainEqual(
      expect.objectContaining({ table: 'conversations' })
    );
  });

  it('deduplicates a replayed echo by conversation and Meta id', async () => {
    h.duplicate = { id: 'already-there' };
    await handleCoexistenceWebhookChange(
      {
        field: 'smb_message_echoes',
        value: {
          metadata: { phone_number_id: '108261528923943' },
          message_echoes: [
            {
              to: '5585999990000',
              id: 'wamid.echo-00000001',
              timestamp: '1700000000',
              type: 'text',
              text: { body: 'duplicate' },
            },
          ],
        },
      },
      '2295585011204142',
      db as never
    );
    expect(h.upserts).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });

  it('imports incremental history with direction and no conversation activity bump', async () => {
    await handleCoexistenceWebhookChange(
      {
        field: 'history',
        value: {
          metadata: { phone_number_id: '108261528923943' },
          history: [
            {
              metadata: { phase: 1, chunk_order: 1, progress: 100 },
              threads: [
                {
                  id: '5585999990000',
                  messages: [
                    {
                      from: '5585999990000',
                      id: 'wamid.history-in-01',
                      timestamp: '1699999900',
                      type: 'text',
                      text: { body: 'Histórico inbound' },
                      history_context: { status: 'read' },
                    },
                    {
                      from: '15550000000',
                      to: '5585999990000',
                      id: 'wamid.history-out01',
                      timestamp: '1699999950',
                      type: 'text',
                      text: { body: 'Histórico outbound' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      '2295585011204142',
      db as never
    );
    expect(h.upserts.map((call) => call.row.sender_type)).toEqual([
      'customer',
      'agent',
    ]);
    expect(
      h.upserts.every((call) => call.row.source === 'coexistence_history')
    ).toBe(true);
    expect(
      h.updates.filter((call) => call.table === 'conversations')
    ).toHaveLength(0);
    expect(h.updates).toContainEqual(
      expect.objectContaining({
        table: 'whatsapp_config',
        row: expect.objectContaining({ history_sync_status: 'completed' }),
      })
    );
  });

  it('creates missing app contacts but never overwrites a manual CRM contact', async () => {
    await handleCoexistenceWebhookChange(
      {
        field: 'smb_app_state_sync',
        value: {
          metadata: { phone_number_id: '108261528923943' },
          state_sync: [
            {
              type: 'contact',
              action: 'add',
              contact: { phone_number: '5585999990000', full_name: 'App name' },
            },
          ],
        },
      },
      '2295585011204142',
      db as never
    );
    expect(h.inserts.filter((call) => call.table === 'contacts')).toHaveLength(
      0
    );
    expect(h.updates.filter((call) => call.table === 'contacts')).toHaveLength(
      0
    );

    h.existingContact = null;
    await handleCoexistenceWebhookChange(
      {
        field: 'smb_app_state_sync',
        value: {
          metadata: { phone_number_id: '108261528923943' },
          state_sync: [
            {
              type: 'contact',
              action: 'add',
              contact: { phone_number: '5585999990000', full_name: 'App name' },
            },
          ],
        },
      },
      '2295585011204142',
      db as never
    );
    expect(h.inserts).toContainEqual(
      expect.objectContaining({
        table: 'contacts',
        row: expect.objectContaining({
          account_id: 'account-A',
          name: 'App name',
        }),
      })
    );
  });

  it('fails closed when the phone cannot resolve to one coexistence tenant', async () => {
    h.configRows = [];
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    await handleCoexistenceWebhookChange(
      {
        field: 'smb_message_echoes',
        value: {
          metadata: { phone_number_id: '108261528923943' },
          message_echoes: [],
        },
      },
      '2295585011204142',
      db as never
    );
    expect(h.upserts).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('no unique validated phone mapping'),
      expect.objectContaining({ field: 'smb_message_echoes' })
    );
    warning.mockRestore();
  });

  it('marks PARTNER_REMOVED disconnected without deleting data or token', async () => {
    await handleCoexistenceWebhookChange(
      {
        field: 'account_update',
        value: {
          event: 'PARTNER_REMOVED',
          waba_info: { waba_id: '2295585011204142' },
          disconnection_info: {
            reason: 'CUSTOMER_REMOVED_PARTNER',
            initiated_by: 'customer',
          },
        },
      },
      '2295585011204142',
      db as never
    );
    expect(h.updates).toContainEqual(
      expect.objectContaining({
        table: 'whatsapp_config',
        row: expect.objectContaining({
          status: 'disconnected',
          disconnect_reason: 'CUSTOMER_REMOVED_PARTNER',
        }),
      })
    );
    expect(h.updates[0].row).not.toHaveProperty('access_token');
  });
});
