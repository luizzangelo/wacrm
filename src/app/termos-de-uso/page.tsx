import type { Metadata } from 'next';
import { LegalPage, type LegalSection } from '@/components/legal/legal-page';

const SITE_URL = 'https://crm.luizangelo.com.br/termos-de-uso';
const SUPPORT_EMAIL = 'lacfprojetos@gmail.com';

export const metadata: Metadata = {
  title: 'Termos de Uso',
  description:
    'Condições aplicáveis ao uso empresarial do WACRM e das integrações com a Plataforma do WhatsApp Business e os serviços da Meta.',
  alternates: {
    canonical: `${SITE_URL}/termos-de-uso`,
  },
  robots: {
    index: true,
    follow: true,
  },
};

const sections: LegalSection[] = [
  {
    id: 'aceitacao',
    title: 'Aceitação dos termos',
    content: (
      <>
        <p>
          Estes Termos de Uso regulam o acesso e a utilização do
          <strong> WACRM</strong>, disponível em
          <strong> crm.luizangelo.com.br</strong>. Ao criar uma conta, acessar
          ou utilizar o serviço, você declara que leu e concorda com estes
          Termos e com a nossa
          <a href="/politica-de-privacidade">Política de Privacidade</a>.
        </p>
        <p>
          Se você utiliza o WACRM em nome de uma empresa, declara possuir
          poderes para vinculá-la a estes Termos. O serviço é destinado a uso
          empresarial por pessoas maiores de 18 anos e legalmente capazes.
        </p>
      </>
    ),
  },
  {
    id: 'servico',
    title: 'Descrição do serviço',
    content: (
      <p>
        O WACRM oferece recursos de atendimento, organização de contatos,
        conversas, funis comerciais, automações, modelos, relatórios e
        integrações empresariais. Determinadas funções dependem de serviços de
        terceiros, especialmente a Plataforma do WhatsApp Business, a Cloud API
        e ferramentas empresariais da Meta.
      </p>
    ),
  },
  {
    id: 'conta',
    title: 'Conta, usuários e segurança',
    content: (
      <>
        <p>
          O usuário deve fornecer informações verdadeiras, atuais e completas,
          manter suas credenciais protegidas e permitir acesso apenas a pessoas
          autorizadas. O administrador da conta é responsável por gerenciar
          membros, funções, permissões, integrações e dados do workspace.
        </p>
        <p>
          Tokens, chaves, senhas e credenciais da Meta ou do WhatsApp são
          confidenciais. Suspeitas de acesso indevido ou incidente devem ser
          comunicadas prontamente. O usuário responde pelas atividades
          realizadas em sua conta até que o acesso indevido seja informado e
          mitigado.
        </p>
      </>
    ),
  },
  {
    id: 'tech-provider',
    title: 'Integração Meta e WhatsApp Tech Provider',
    content: (
      <>
        <p>
          Ao conectar uma conta do WhatsApp Business, o cliente autoriza o WACRM
          a acessar os ativos e dados estritamente necessários para configurar e
          operar a integração, incluindo conta empresarial, números, modelos,
          mensagens, webhooks, métricas, atribuição CTWA e eventos de conversão
          habilitados pelo cliente.
        </p>
        <p>
          O cliente permanece responsável e no controle de seus ativos
          empresariais, das pessoas autorizadas e das decisões sobre suas
          comunicações. O WACRM não é o WhatsApp, o Facebook ou a Meta e não
          declara patrocínio ou afiliação além da integração técnica autorizada.
          WhatsApp e Meta podem revisar, limitar, suspender ou alterar suas APIs
          e políticas independentemente do WACRM.
        </p>
      </>
    ),
  },
  {
    id: 'obrigacoes-mensagens',
    title: 'Consentimento e regras de mensagens',
    content: (
      <>
        <p>O cliente se compromete a:</p>
        <ul>
          <li>
            possuir base legal, avisos e consentimentos aplicáveis para coletar,
            usar e compartilhar dados de contatos;
          </li>
          <li>
            obter opt-in válido antes de iniciar comunicações quando exigido e
            manter evidências dessa autorização;
          </li>
          <li>
            identificar corretamente o remetente, informar a natureza das
            mensagens e respeitar imediatamente pedidos de opt-out;
          </li>
          <li>
            utilizar modelos aprovados para conversas iniciadas pela empresa e
            observar a janela de atendimento e demais regras vigentes do
            WhatsApp;
          </li>
          <li>
            oferecer caminho claro para atendimento humano quando utilizar
            automações e revisar regularmente a qualidade das comunicações;
          </li>
          <li>
            cumprir a LGPD, o Código de Defesa do Consumidor e demais normas
            aplicáveis à sua atividade.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'uso-proibido',
    title: 'Usos proibidos',
    content: (
      <>
        <p>É proibido usar o WACRM para:</p>
        <ul>
          <li>
            spam, listas obtidas irregularmente, comunicações enganosas ou envio
            em massa sem autorização;
          </li>
          <li>
            fraude, falsidade ideológica, assédio, discriminação, ameaça ou
            violação de direitos de terceiros;
          </li>
          <li>
            transmitir malware, explorar vulnerabilidades, contornar limites ou
            interferir na segurança e disponibilidade da plataforma;
          </li>
          <li>
            coletar ou compartilhar dados pessoais sem base legal, inclusive
            identificadores financeiros, documentos completos ou dados sensíveis
            sem necessidade e proteção adequadas;
          </li>
          <li>
            oferecer produtos, serviços ou conteúdos proibidos pelas políticas
            comerciais e de mensagens da Meta e do WhatsApp;
          </li>
          <li>
            realizar engenharia reversa, revender acesso não autorizado ou usar
            o serviço de forma incompatível com sua finalidade empresarial.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'dados-clientes',
    title: 'Dados, conteúdo e responsabilidades do cliente',
    content: (
      <>
        <p>
          O cliente conserva seus direitos sobre os dados e conteúdos que insere
          no WACRM. Concede ao serviço autorização limitada para hospedar,
          processar, transmitir, reproduzir tecnicamente e exibir esses
          conteúdos somente para prestar, proteger e melhorar as funções
          contratadas.
        </p>
        <p>
          O cliente é o controlador dos dados de seus contatos e responde pela
          licitude, exatidão e instruções de tratamento. Deve atender direitos
          dos titulares, restringir acessos internos e não inserir conteúdo que
          viole sigilo, propriedade intelectual, privacidade ou qualquer lei. O
          WACRM atuará como operador nesses tratamentos, conforme descrito na
          Política de Privacidade.
        </p>
      </>
    ),
  },
  {
    id: 'capi-automacoes',
    title: 'Conversões, automações e decisões humanas',
    content: (
      <>
        <p>
          Quando o cliente habilita a Meta Conversions API, o WACRM pode enviar
          eventos do funil e identificadores exigidos pela integração. O cliente
          é responsável por configurar os eventos corretamente, possuir base
          legal para o compartilhamento e não enviar categorias proibidas ou
          informações excessivas.
        </p>
        <p>
          Automações auxiliam operações, mas não substituem supervisão humana. O
          cliente deve revisar fluxos, mensagens, critérios e resultados,
          especialmente quando possam afetar direitos ou gerar consequências
          relevantes para uma pessoa.
        </p>
      </>
    ),
  },
  {
    id: 'terceiros',
    title: 'Serviços e políticas de terceiros',
    content: (
      <>
        <p>
          O uso das integrações depende da aceitação e do cumprimento dos termos
          aplicáveis de terceiros, incluindo os
          <a
            href="https://www.whatsapp.com/legal/business-terms/"
            target="_blank"
            rel="noreferrer"
          >
            Termos de Serviço do WhatsApp Business
          </a>
          , a
          <a
            href="https://business.whatsapp.com/policy/preview?lang=pt_BR"
            target="_blank"
            rel="noreferrer"
          >
            Política de Mensagens do WhatsApp Business
          </a>{' '}
          e os termos da Meta aplicáveis aos produtos utilizados.
        </p>
        <p>
          Alterações, indisponibilidade, limites, preços, aprovação de modelos,
          qualidade, bloqueios ou encerramentos impostos por terceiros não são
          controlados pelo WACRM. O cliente deve manter seus cadastros e ativos
          empresariais regulares junto a esses provedores.
        </p>
      </>
    ),
  },
  {
    id: 'propriedade-intelectual',
    title: 'Propriedade intelectual',
    content: (
      <p>
        O software, a interface, a identidade visual, a documentação e os demais
        elementos do WACRM são protegidos pela legislação aplicável. Estes
        Termos concedem apenas uma licença limitada, revogável, não exclusiva e
        intransferível para uso interno e empresarial da plataforma enquanto a
        conta estiver regular. Marcas da Meta e do WhatsApp pertencem aos seus
        respectivos titulares.
      </p>
    ),
  },
  {
    id: 'disponibilidade',
    title: 'Disponibilidade e alterações',
    content: (
      <>
        <p>
          Buscamos manter o serviço seguro e disponível, mas podem ocorrer
          manutenções, falhas de rede, incidentes, mudanças de APIs ou eventos
          fora do controle razoável. Não garantimos funcionamento ininterrupto
          de integrações mantidas por terceiros.
        </p>
        <p>
          Recursos podem ser corrigidos, substituídos ou descontinuados para
          atender requisitos técnicos, legais ou de segurança. Quando viável,
          mudanças materiais serão comunicadas com antecedência razoável.
        </p>
      </>
    ),
  },
  {
    id: 'suspensao',
    title: 'Suspensão e encerramento',
    content: (
      <p>
        O acesso pode ser limitado ou suspenso para conter incidente, prevenir
        abuso, cumprir ordem legal, proteger terceiros ou responder a violação
        destes Termos e das políticas aplicáveis. O cliente pode deixar de usar
        o serviço e solicitar encerramento e exclusão de dados, respeitadas as
        retenções legais e técnicas descritas na Política de Privacidade.
      </p>
    ),
  },
  {
    id: 'responsabilidade',
    title: 'Limites de responsabilidade',
    content: (
      <>
        <p>
          Cada parte responde pelos atos sob seu controle. Na máxima extensão
          permitida pela lei, o WACRM não responde por atos do cliente, conteúdo
          enviado por usuários, perda causada por credenciais comprometidas pelo
          cliente, decisões de terceiros ou indisponibilidade da Meta, WhatsApp,
          operadoras e redes externas.
        </p>
        <p>
          Nenhuma disposição destes Termos exclui garantias, deveres ou direitos
          que não possam ser afastados pela legislação brasileira, inclusive os
          direitos assegurados aos consumidores quando aplicáveis.
        </p>
      </>
    ),
  },
  {
    id: 'lei-contato',
    title: 'Lei aplicável, atualizações e contato',
    content: (
      <>
        <p>
          Estes Termos são regidos pelas leis da República Federativa do Brasil.
          Eventuais controvérsias serão submetidas ao foro legalmente
          competente, preservadas as regras obrigatórias de proteção do
          consumidor.
        </p>
        <p>
          Podemos atualizar estes Termos por razões legais, regulatórias,
          técnicas ou operacionais. A versão vigente permanecerá nesta URL com a
          data de atualização. Dúvidas sobre estes Termos e privacidade podem
          ser enviadas para{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </>
    ),
  },
];

export default function TermsOfUsePage() {
  return (
    <LegalPage
      documentType="terms"
      eyebrow="Regras para uso empresarial"
      title="Termos de Uso"
      description="As condições para utilizar o WACRM e conectar ativos empresariais da Meta e do WhatsApp com segurança e responsabilidade."
      updatedAt="19 de setembro de 2026"
      sections={sections}
    />
  );
}
