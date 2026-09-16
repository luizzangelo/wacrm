import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/pt-BR.json';
import { serializeEventDiagnostic } from '@/lib/meta-conversions/event-diagnostics';
vi.mock('next-intl', () => ({
  useTranslations: () => (key: keyof typeof messages.MetaConversionEvents) =>
    messages.MetaConversionEvents[key],
}));
import { MetaConversionEventDiagnostic } from './meta-conversion-events';

describe('event diagnostic presentation', () => {
  it.each(['failed', 'delivery_unknown'])(
    'renders %s diagnostics with zero retry actions',
    (status) => {
      const event = serializeEventDiagnostic({
        event_name: 'Purchase',
        status,
        attempts: 1,
        meta_http_status: 400,
        meta_response: {
          error: {
            code: 100,
            error_subcode: 2804132,
            message: 'PRIVATE_RESPONSE',
          },
        },
        value: 150,
        currency: 'BRL',
        error_message: 'PRIVATE_RESPONSE',
      });
      const html = renderToStaticMarkup(
        <MetaConversionEventDiagnostic
          event={event}
          datasetId="2000316380612611"
        />
      );
      expect(html).toContain(status);
      expect(html).toContain('2804132');
      expect(html).toContain('150');
      expect(html).toContain('BRL');
      expect(html).toContain('Deal removido');
      expect(html).not.toContain('PRIVATE_RESPONSE');
      expect(html).not.toMatch(/<button|<form|href=/);
      expect(html).not.toMatch(
        />\s*(Retry|Reenviar|Tentar novamente|Resetar)\s*</i
      );
      if (status === 'failed')
        expect(html).toContain('Meta rejeitou definitivamente');
      else {
        expect(html).toContain('Não reenviar automaticamente');
        expect(html).toContain('evitar conversão duplicada');
        expect(html).toContain('border-amber');
      }
    }
  );
  it('displays only safe contact identification', () => {
    const event = serializeEventDiagnostic(
      {
        event_name: 'LeadSubmitted',
        status: 'sent',
        name: 'Full Private Name',
        phone: '5585999991234',
        email: 'private@example.test',
      },
      { contactId: '66666666-6666-4666-8666-666666666666' }
    );
    const html = renderToStaticMarkup(
      <MetaConversionEventDiagnostic event={event} datasetId={null} />
    );
    expect(html).toContain('Contato · 66666666');
    expect(html).not.toContain('Full Private Name');
    expect(html).not.toContain('5585999991234');
    expect(html).not.toContain('private@example.test');
  });
  it('shows stale warning without recovery controls or false immutable attempt time', () => {
    const event = serializeEventDiagnostic(
      {
        event_name: 'QualifiedLead',
        status: 'sending',
        updated_at: '2026-09-16T10:00:00Z',
      },
      {},
      Date.parse('2026-09-16T10:01:00Z')
    );
    const html = renderToStaticMarkup(
      <MetaConversionEventDiagnostic event={event} datasetId={null} />
    );
    expect(html).toContain('Envio não finalizado');
    expect(html).toContain('não é um timestamp imutável');
    expect(html).not.toContain('<button');
  });
});
