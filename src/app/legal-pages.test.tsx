// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PrivacyPolicyPage, {
  metadata as privacyMetadata,
} from './politica-de-privacidade/page';
import TermsOfUsePage, {
  metadata as termsMetadata,
} from './termos-de-uso/page';
import DataDeletionPage, {
  metadata as deletionMetadata,
} from './exclusao-de-dados/page';

describe('public legal pages', () => {
  it('publishes the LGPD and Meta/WhatsApp privacy disclosures', () => {
    render(<PrivacyPolicyPage />);

    expect(
      screen.getByRole('heading', { name: 'Política de Privacidade', level: 1 })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Papéis segundo a LGPD', level: 2 })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: 'Meta, WhatsApp e atuação como Tech Provider',
        level: 2,
      })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: 'Solicitação de exclusão e revogação da integração',
        level: 2,
      })
    ).toBeTruthy();
    expect(
      screen.getAllByRole('link', {
        name: 'lacfprojetos@gmail.com',
      })
    ).not.toHaveLength(0);
    expect(privacyMetadata.alternates?.canonical).toBe(
      'https://crm.luizangelo.com.br/politica-de-privacidade'
    );
  });

  it('publishes business, opt-in and acceptable-use terms', () => {
    render(<TermsOfUsePage />);

    expect(
      screen.getByRole('heading', { name: 'Termos de Uso', level: 1 })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: 'Integração Meta e WhatsApp Tech Provider',
        level: 2,
      })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: 'Consentimento e regras de mensagens',
        level: 2,
      })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Usos proibidos', level: 2 })
    ).toBeTruthy();
    expect(termsMetadata.alternates?.canonical).toBe(
      'https://crm.luizangelo.com.br/termos-de-uso'
    );
  });

  it('cross-links both documents and the login from each page', () => {
    const { unmount } = render(<PrivacyPolicyPage />);
    expect(
      screen
        .getAllByRole('link', { name: 'Termos de Uso' })[0]
        .getAttribute('href')
    ).toBe('/termos-de-uso');
    expect(
      screen
        .getAllByRole('link', { name: 'Acessar o WACRM' })[0]
        .getAttribute('href')
    ).toBe('/login');
    unmount();

    render(<TermsOfUsePage />);
    expect(
      screen
        .getAllByRole('link', { name: 'Política de Privacidade' })[0]
        .getAttribute('href')
    ).toBe('/politica-de-privacidade');
  });

  it('publishes public Meta-linked data deletion instructions', () => {
    render(<DataDeletionPage />);

    expect(
      screen.getByRole('heading', { name: 'Exclusão de Dados', level: 1 })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: 'Dados vinculados à Meta e ao WhatsApp',
        level: 2,
      })
    ).toBeTruthy();
    expect(
      screen.getAllByRole('link', { name: 'lacfprojetos@gmail.com' })
    ).not.toHaveLength(0);
    expect(deletionMetadata.alternates?.canonical).toBe(
      'https://crm.luizangelo.com.br/exclusao-de-dados'
    );
  });
});
