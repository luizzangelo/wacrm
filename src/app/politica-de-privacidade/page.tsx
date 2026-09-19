import type { Metadata } from 'next';
import { LegalPage, type LegalSection } from '@/components/legal/legal-page';

const SITE_URL = 'https://crm.luizangelo.com.br';
const PRIVACY_EMAIL = 'lacfprojetos@gmail.com';

export const metadata: Metadata = {
  title: 'Política de Privacidade',
  description:
    'Saiba como o WACRM trata e protege dados pessoais em conformidade com a LGPD e com as regras da Plataforma do WhatsApp Business.',
  alternates: {
    canonical: `${SITE_URL}/politica-de-privacidade`,
  },
  robots: {
    index: true,
    follow: true,
  },
};

const sections: LegalSection[] = [
  {
    id: 'apresentacao',
    title: 'Apresentação e abrangência',
    content: (
      <>
        <p>
          Esta Política de Privacidade descreve como o <strong>WACRM</strong>,
          serviço disponível em <strong>crm.luizangelo.com.br</strong>, coleta,
          utiliza, armazena, compartilha e protege dados pessoais. Ela se aplica
          aos usuários da plataforma, às empresas clientes e às pessoas que se
          comunicam com essas empresas pelo WhatsApp.
        </p>
        <p>
          O WACRM é uma solução empresarial de CRM, atendimento, automação e
          gestão comercial integrada à Plataforma do WhatsApp Business e a
          outros serviços da Meta. Esta política deve ser lida em conjunto com
          os nossos <a href="/termos-de-uso">Termos de Uso</a>.
        </p>
      </>
    ),
  },
  {
    id: 'papeis-lgpd',
    title: 'Papéis segundo a LGPD',
    content: (
      <>
        <p>
          Para dados necessários ao cadastro, autenticação, segurança, suporte e
          administração da própria plataforma, o WACRM atua como
          <strong> controlador</strong>, pois define as finalidades essenciais
          desse tratamento.
        </p>
        <p>
          Para contatos, conversas, arquivos, negócios e demais dados inseridos
          ou recebidos por uma empresa cliente, essa empresa normalmente atua
          como <strong>controladora</strong> e o WACRM atua como
          <strong> operador</strong>, tratando os dados conforme as instruções
          do cliente e para prestar o serviço contratado. Cada cliente é
          responsável por fornecer avisos adequados, definir bases legais e
          atender os titulares relacionados às suas atividades.
        </p>
      </>
    ),
  },
  {
    id: 'dados-tratados',
    title: 'Dados pessoais tratados',
    content: (
      <>
        <p>Podemos tratar as seguintes categorias de dados:</p>
        <ul>
          <li>
            dados da conta e dos usuários, como nome, e-mail, identificadores,
            função, preferências e dados de autenticação;
          </li>
          <li>
            dados de contatos comerciais, como nome, telefone, e-mail,
            etiquetas, campos personalizados, anotações e histórico de negócio;
          </li>
          <li>
            conteúdo de atendimento, incluindo mensagens, respostas, mídias,
            documentos, áudios e metadados de entrega;
          </li>
          <li>
            dados da integração empresarial, como identificadores da conta do
            WhatsApp Business, número de telefone, modelos, webhooks e estados
            de configuração;
          </li>
          <li>
            dados de anúncios e conversões, como identificador de clique CTWA,
            campanha, anúncio, eventos de funil e dados de contato transformados
            por hash quando o cliente habilita a Meta Conversions API;
          </li>
          <li>
            registros técnicos e de segurança, como endereço IP, data e hora,
            navegador, dispositivo, logs de acesso e eventos de auditoria.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'fontes',
    title: 'Como os dados são obtidos',
    content: (
      <p>
        Os dados podem ser fornecidos diretamente pelo usuário ou pela empresa
        cliente, recebidos de pessoas que conversam com o negócio, gerados pelo
        uso da plataforma ou obtidos das APIs, webhooks e recursos empresariais
        da Meta e do WhatsApp autorizados pelo cliente. Também recebemos dados
        técnicos do navegador e da infraestrutura necessários ao funcionamento e
        à segurança do serviço.
      </p>
    ),
  },
  {
    id: 'finalidades-bases',
    title: 'Finalidades e bases legais',
    content: (
      <>
        <p>Tratamos dados pessoais para:</p>
        <ul>
          <li>criar contas, autenticar usuários e administrar workspaces;</li>
          <li>
            receber, organizar e enviar comunicações empresariais autorizadas;
          </li>
          <li>
            executar funis, automações, atribuições de anúncio e relatórios;
          </li>
          <li>
            prestar suporte, prevenir fraude, investigar incidentes e proteger
            contas, usuários e a infraestrutura;
          </li>
          <li>
            cumprir obrigações legais, regulatórias e ordens de autoridades;
          </li>
          <li>
            exercer direitos em processos administrativos, arbitrais ou
            judiciais.
          </li>
        </ul>
        <p>
          Conforme o contexto, o tratamento poderá se apoiar na execução de
          contrato ou de procedimentos preliminares, no cumprimento de obrigação
          legal ou regulatória, no legítimo interesse com avaliação de impactos,
          no exercício regular de direitos ou no consentimento, quando ele for a
          base adequada. O envio de mensagens promocionais exige a autorização
          aplicável e deve respeitar pedidos de cancelamento.
        </p>
      </>
    ),
  },
  {
    id: 'meta-whatsapp',
    title: 'Meta, WhatsApp e atuação como Tech Provider',
    content: (
      <>
        <p>
          Quando autorizado por uma empresa cliente, o WACRM acessa e processa
          dados da conta do WhatsApp Business exclusivamente para conectar a
          Cloud API, administrar mensagens e modelos, receber webhooks, exibir
          métricas e oferecer as funções contratadas. O cliente mantém o
          controle sobre seus ativos comerciais e pode revogar as permissões
          concedidas.
        </p>
        <p>
          Em atribuição Click-to-WhatsApp e conversões, podemos tratar o
          identificador de clique e enviar eventos comerciais à Meta. Dados como
          telefone, e-mail e nome são normalizados e enviados por hash
          criptográfico quando exigido pela integração; o identificador CTWA e o
          identificador da conta do WhatsApp Business seguem o formato técnico
          exigido pela Meta. Esses dados não são vendidos nem usados para criar
          perfis publicitários próprios do WACRM.
        </p>
        <p>
          O uso desses serviços também está sujeito aos
          <a
            href="https://www.whatsapp.com/legal/business-terms/"
            target="_blank"
            rel="noreferrer"
          >
            Termos do WhatsApp Business
          </a>{' '}
          e à
          <a
            href="https://business.whatsapp.com/policy/preview?lang=pt_BR"
            target="_blank"
            rel="noreferrer"
          >
            Política de Mensagens do WhatsApp Business
          </a>
          . Meta e WhatsApp tratam determinados dados conforme suas próprias
          políticas e responsabilidades legais.
        </p>
      </>
    ),
  },
  {
    id: 'compartilhamento',
    title: 'Compartilhamento e operadores',
    content: (
      <>
        <p>
          Compartilhamos dados apenas na medida necessária para operar a
          plataforma, cumprir instruções do cliente ou atender à lei. Isso pode
          incluir provedores de banco de dados, autenticação, armazenamento,
          hospedagem, monitoramento e segurança, além da Meta e do WhatsApp
          quando as integrações forem habilitadas.
        </p>
        <p>
          Também poderemos compartilhar informações com autoridades competentes
          quando houver obrigação legal, ordem válida ou necessidade de proteger
          direitos e prevenir danos. Não comercializamos dados pessoais. Dados
          de uma conta não são disponibilizados a outra conta do WACRM.
        </p>
      </>
    ),
  },
  {
    id: 'transferencias',
    title: 'Transferências internacionais',
    content: (
      <p>
        Alguns provedores e empresas do grupo Meta podem tratar dados fora do
        Brasil. Quando houver transferência internacional, adotamos mecanismos
        compatíveis com a LGPD e medidas contratuais, técnicas e organizacionais
        apropriadas ao tipo de dado e ao risco envolvido.
      </p>
    ),
  },
  {
    id: 'retencao',
    title: 'Retenção e exclusão',
    content: (
      <>
        <p>
          Conservamos os dados pelo período necessário para prestar o serviço,
          manter a segurança, cumprir obrigações legais e resguardar o exercício
          de direitos. Encerrada a finalidade, os dados são eliminados ou
          anonimizados, salvo quando a retenção for permitida ou exigida por
          lei. Cópias residuais podem permanecer temporariamente em backups
          protegidos até o ciclo regular de substituição.
        </p>
        <p>
          A exclusão no WACRM não controla os prazos independentes de retenção
          da Meta, do WhatsApp ou de outros controladores. A empresa cliente
          também pode ter obrigação própria de conservar registros.
        </p>
      </>
    ),
  },
  {
    id: 'direitos',
    title: 'Direitos dos titulares',
    content: (
      <>
        <p>
          Nos termos da LGPD, o titular pode solicitar confirmação e acesso,
          correção, anonimização, bloqueio ou eliminação de dados desnecessários
          ou tratados irregularmente, portabilidade quando regulamentada,
          informação sobre compartilhamentos, revisão de decisões automatizadas,
          oposição e revogação do consentimento, quando aplicáveis.
        </p>
        <p>
          Quando os dados tiverem sido inseridos por uma empresa cliente, o
          pedido deve preferencialmente ser dirigido a essa empresa, que é a
          controladora. O WACRM auxiliará o cliente no atendimento quando atuar
          como operador.
        </p>
      </>
    ),
  },
  {
    id: 'exclusao-meta',
    title: 'Solicitação de exclusão e revogação da integração',
    content: (
      <>
        <p>
          Para solicitar exclusão ou exercer direitos, envie um e-mail para{' '}
          <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> com o assunto
          <strong> “Privacidade — solicitação de dados”</strong>. Informe apenas
          o necessário para localizar a conta ou o atendimento e descreva o
          pedido. Poderemos solicitar confirmação de identidade para impedir
          acesso ou exclusão indevida.
        </p>
        <p>
          O administrador da empresa pode ainda desconectar os ativos do
          WhatsApp Business e revogar permissões nas configurações empresariais
          da Meta. A revogação interrompe novos acessos, mas não substitui um
          pedido de exclusão dos dados já armazenados nem afasta retenções
          legais obrigatórias.
        </p>
      </>
    ),
  },
  {
    id: 'seguranca-cookies',
    title: 'Segurança, cookies e armazenamento local',
    content: (
      <>
        <p>
          Adotamos controles de acesso, isolamento entre contas, privilégio
          mínimo, registros de auditoria, backups e criptografia em trânsito,
          além de processos destinados a prevenir acesso, alteração, perda ou
          divulgação não autorizada. Nenhum sistema é totalmente imune a riscos;
          incidentes relevantes serão tratados e comunicados conforme a lei.
        </p>
        <p>
          O WACRM utiliza cookies e armazenamento local essenciais para sessão,
          segurança, idioma, tema e preferências. Não usamos esses mecanismos
          para vender dados pessoais. Recursos de terceiros eventualmente
          habilitados podem estar sujeitos às políticas desses provedores.
        </p>
      </>
    ),
  },
  {
    id: 'contato-atualizacoes',
    title: 'Contato e atualizações',
    content: (
      <>
        <p>
          O canal de privacidade do WACRM é{' '}
          <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>. Solicitações
          serão avaliadas conforme o papel do WACRM no tratamento e os prazos
          legais aplicáveis. O serviço não é direcionado a crianças ou
          adolescentes e deve ser utilizado em contexto empresarial por pessoas
          autorizadas.
        </p>
        <p>
          Esta política poderá ser atualizada para refletir mudanças legais,
          regulatórias, técnicas ou operacionais. A versão vigente permanecerá
          publicada nesta URL, com a data da última atualização.
        </p>
      </>
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      documentType="privacy"
      eyebrow="Privacidade e proteção de dados"
      title="Política de Privacidade"
      description="Como o WACRM trata dados pessoais, protege as informações das contas e opera integrações com a Meta e o WhatsApp em conformidade com a LGPD."
      updatedAt="19 de setembro de 2026"
      sections={sections}
    />
  );
}
