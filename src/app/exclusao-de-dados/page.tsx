import type { Metadata } from 'next';
import { LegalPage, type LegalSection } from '@/components/legal/legal-page';

const SITE_URL = 'https://crm.luizangelo.com.br';
const PRIVACY_EMAIL = 'lacfprojetos@gmail.com';

export const metadata: Metadata = {
  title: 'Exclusão de Dados',
  description:
    'Instruções para solicitar a exclusão de dados pessoais e dados vinculados às integrações Meta e WhatsApp no WACRM.',
  alternates: {
    canonical: `${SITE_URL}/exclusao-de-dados`,
  },
  robots: {
    index: true,
    follow: true,
  },
};

const sections: LegalSection[] = [
  {
    id: 'como-solicitar',
    title: 'Como solicitar a exclusão',
    content: (
      <>
        <p>
          Para solicitar a exclusão de dados vinculados ao WACRM, envie um
          e-mail para <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>{' '}
          com o assunto
          <strong> “Exclusão de dados — WACRM”</strong>. Informe somente os
          dados necessários para identificar a conta ou o atendimento e descreva
          quais informações deseja excluir.
        </p>
        <p>
          Se você se comunicou pelo WhatsApp com uma empresa que utiliza o
          WACRM, também poderá apresentar o pedido diretamente a essa empresa,
          que normalmente é a controladora dos dados dessa conversa.
        </p>
      </>
    ),
  },
  {
    id: 'confirmacao-identidade',
    title: 'Confirmação de identidade',
    content: (
      <p>
        Para proteger o titular e evitar exclusões indevidas, poderemos pedir
        informações adicionais estritamente necessárias para confirmar a
        identidade, a legitimidade do solicitante ou sua autorização para
        representar uma empresa. Não envie senha, token de acesso, código de
        autenticação ou segredo de integração.
      </p>
    ),
  },
  {
    id: 'dados-meta-whatsapp',
    title: 'Dados vinculados à Meta e ao WhatsApp',
    content: (
      <>
        <p>
          O pedido pode abranger dados recebidos ou processados pelo WACRM por
          meio das integrações autorizadas com a Meta e o WhatsApp, como
          identificadores empresariais, contatos, conversas, mídias e metadados
          armazenados na conta do cliente.
        </p>
        <p>
          O administrador da empresa também pode desconectar a integração no
          WACRM e revogar permissões nas configurações empresariais da Meta.
          Revogar a integração interrompe novos acessos, mas não substitui o
          pedido de exclusão de dados já armazenados.
        </p>
      </>
    ),
  },
  {
    id: 'tratamento-pedido',
    title: 'Tratamento do pedido',
    content: (
      <>
        <p>
          Após a validação, localizaremos os dados abrangidos e adotaremos as
          medidas aplicáveis de exclusão, anonimização ou bloqueio. Quando o
          WACRM atuar como operador, o pedido poderá ser encaminhado à empresa
          cliente responsável para confirmação e atendimento conforme suas
          instruções.
        </p>
        <p>
          Informaremos a conclusão ou eventual necessidade de informações
          adicionais pelo mesmo canal utilizado no pedido.
        </p>
      </>
    ),
  },
  {
    id: 'retencao',
    title: 'Retenções aplicáveis',
    content: (
      <p>
        Alguns registros poderão ser conservados pelo prazo necessário ao
        cumprimento de obrigação legal ou regulatória, à segurança, à prevenção
        de fraude e ao exercício regular de direitos. Cópias residuais podem
        permanecer temporariamente em backups protegidos até o ciclo regular de
        substituição. Meta, WhatsApp e a empresa cliente podem aplicar seus
        próprios prazos de retenção como controladores independentes.
      </p>
    ),
  },
  {
    id: 'privacidade',
    title: 'Mais informações',
    content: (
      <p>
        Consulte a nossa{' '}
        <a href="/politica-de-privacidade">Política de Privacidade</a> para
        conhecer as categorias de dados, finalidades, bases legais, medidas de
        segurança e demais direitos previstos na LGPD. Dúvidas podem ser
        enviadas para <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.
      </p>
    ),
  },
];

export default function DataDeletionPage() {
  return (
    <LegalPage
      documentType="deletion"
      eyebrow="Privacidade e controle de dados"
      title="Exclusão de Dados"
      description="Como solicitar a exclusão de dados pessoais e informações vinculadas ao WACRM e às integrações autorizadas com a Meta e o WhatsApp."
      updatedAt="19 de setembro de 2026"
      sections={sections}
    />
  );
}
