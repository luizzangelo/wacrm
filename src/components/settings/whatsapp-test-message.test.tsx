// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WhatsAppTestMessage } from './whatsapp-test-message';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WhatsAppTestMessage', () => {
  it('sends only the destination phone and shows the success state', async () => {
    let releaseResponse: ((value: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          releaseResponse = resolve;
        })
    );
    render(<WhatsAppTestMessage connected canSend />);

    fireEvent.change(screen.getByLabelText('Número do destinatário'), {
      target: { value: '+55 85 99999-0000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar Hello World' }));

    expect(
      screen
        .getByRole('button', { name: 'Enviando...' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/whatsapp/test-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+55 85 99999-0000' }),
    });
    releaseResponse?.(
      new Response(
        JSON.stringify({
          success: true,
          whatsapp_message_id: 'wamid.not-rendered-in-settings',
        }),
        { status: 200 }
      )
    );

    expect((await screen.findByRole('status')).textContent).toContain(
      'Mensagem enviada.'
    );
    expect(screen.queryByText(/wamid/i)).toBeNull();
  });

  it('shows the sanitized backend error without technical credentials', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'A Meta não aceitou a mensagem de teste.',
        }),
        { status: 502 }
      )
    );
    render(<WhatsAppTestMessage connected canSend />);

    fireEvent.change(screen.getByLabelText('Número do destinatário'), {
      target: { value: '+14155550123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar Hello World' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'A Meta não aceitou a mensagem de teste.'
    );
    expect(screen.queryByText(/access[_ ]token/i)).toBeNull();
    expect(screen.queryByText(/phone[_ ]number[_ ]id/i)).toBeNull();
  });

  it('keeps the action disabled when WhatsApp is disconnected', () => {
    render(<WhatsAppTestMessage connected={false} canSend />);

    fireEvent.change(screen.getByLabelText('Número do destinatário'), {
      target: { value: '+14155550123' },
    });

    expect(
      screen
        .getByRole('button', { name: 'Enviar Hello World' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(
      screen.getByText('Conecte o WhatsApp para habilitar o envio.')
    ).not.toBeNull();
  });

  it('does not submit when the current user cannot edit WhatsApp settings', async () => {
    render(<WhatsAppTestMessage connected canSend={false} />);

    expect(
      screen.getByLabelText('Número do destinatário').hasAttribute('disabled')
    ).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'Enviar Hello World' })
        .hasAttribute('disabled')
    ).toBe(true);
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });
});
