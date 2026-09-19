# Meta WhatsApp Embedded Signup com coexistência

## Objetivo e limites

Este runbook descreve o onboarding SaaS do WhatsApp Business App em modo de
coexistência. O cliente conecta o número pelo fluxo oficial da Meta e continua
usando o aplicativo no celular. O WACRM não chama o endpoint legado
`/{phone_number_id}/register` nesse fluxo.

As versões atuais usam Embedded Signup v4, Session Info v3 e Graph API v26.0
para as chamadas novas. As integrações legadas do WhatsApp mantêm suas versões
atuais.

## Configuração

Variáveis públicas de build/runtime:

- `NEXT_PUBLIC_META_APP_ID`: App ID da Meta;
- `NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID`: configuração do Embedded
  Signup.

Variáveis somente do servidor:

- `META_APP_SECRET`: segredo do mesmo App ID;
- `META_EMBEDDED_SIGNUP_GRAPH_VERSION`: versão Graph, opcional, com padrão
  `v26.0`;
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: token global do callback SaaS.

`META_APP_SECRET`, tokens de acesso e o verify token nunca podem receber o
prefixo `NEXT_PUBLIC_`, ser incluídos em logs, respostas da API ou imagens.
As variáveis públicas precisam estar disponíveis também durante o build do
Next.js.

## Arquitetura do onboarding

1. Um owner/admin abre Configurações → WhatsApp e escolhe **Conectar
   WhatsApp**.
2. O browser carrega uma única instância do SDK oficial e chama `FB.login` com
   `response_type: "code"`, `override_default_response_type: true`,
   `featureType: "whatsapp_business_app_onboarding"` e Session Info v3.
3. O listener aceita `postMessage` somente de origens Facebook conhecidas e
   interpreta finish, cancel e error. O `phone_number_id` é opcional.
4. O browser combina o authorization code com os hints mínimos da sessão e os
   envia a `POST /api/whatsapp/embedded-signup/complete`.
5. O backend exige sessão, role admin, same-origin e rate limit. A account vem
   exclusivamente da sessão; IDs do browser nunca concedem autorização.
6. O backend troca o code uma única vez, valida o App ID, scopes, acesso
   granular à WABA e descobre os números pela Graph API.
7. Apenas números com `is_on_biz_app=true` e `platform_type=CLOUD_API` são
   elegíveis. Um único número é escolhido automaticamente; múltiplos números
   geram uma seleção explícita em sessão curta, server-only.
8. Antes de persistir, o backend verifica se o número já pertence a outra
   account. O token é cifrado com a implementação AES-256-GCM existente.
9. O App é inscrito em `/{WABA_ID}/subscribed_apps` e a inscrição é confirmada
   por GET. Só então a configuração se torna `connected`.
10. O backend solicita uma vez `smb_app_state_sync` e uma vez `history` em
    `/{PHONE_NUMBER_ID}/smb_app_data`. Resultados ambíguos ficam terminais como
    `delivery_unknown`, sem retry cego.

O authorization code não é persistido. Se a troca tiver resultado ambíguo, o
mesmo code não deve ser reutilizado; o usuário inicia um novo onboarding.

## Persistência

`whatsapp_config` continua sendo account-scoped e mantém uma configuração por
account e um `phone_number_id` único globalmente. O modo coexistência registra:

- método de conexão e ativos Meta comprovados;
- metadados do número e do token, sem expor a credencial;
- estado/timestamps da inscrição do App;
- estado, request ID e timestamps dos dois syncs;
- estado de desconexão/offboarding.

`whatsapp_embedded_signup_sessions` guarda temporariamente uma seleção
ambígua de números e o token cifrado. A tabela tem RLS, não concede acesso a
`anon`/`authenticated` e é acessada somente pelo backend com service role.

`messages.source` distingue `cloud_api`, `whatsapp_business_app` e
`coexistence_history`.

## Webhooks de coexistência

O callback continua exigindo HMAC SHA-256. O tenant é resolvido pelo ativo Meta
persistido, nunca por `account_id` recebido externamente.

- `smb_message_echoes`: cria mensagem outbound com origem Business App,
  preserva o timestamp e deduplica. Não incrementa unread, não aciona IA,
  autoresposta, automação inbound, conversão ou novo envio Cloud API.
- `history`: importa incrementalmente mensagens inbound/outbound, preserva
  timestamps e deduplica. Importação não altera a atividade da conversa nem
  aciona notificações, automações, IA ou conversões.
- `smb_app_state_sync`: cria somente contatos ausentes e account-scoped; não
  sobrescreve campos editados no CRM nem processa remoções destrutivas.
- `account_update` com `PARTNER_REMOVED`: marca as configurações da WABA como
  desconectadas. Não apaga token, mensagens, histórico ou account.
- `messages` e `statuses`: continuam no caminho legado já existente.

O trigger de criação automática de negócio aceita somente mensagens com
`source='cloud_api'`, impedindo side effects de importações e echoes.

## Desconexão

`POST /api/whatsapp/embedded-signup/disconnect` exige confirmação, admin,
same-origin e rate limit. Ele marca a conexão como desconectada e preserva o
histórico e a credencial cifrada para recuperação. Não chama `deregister`, não
desativa o WhatsApp Business App e não remove o parceiro na Meta.

O cliente deve concluir a remoção do parceiro no próprio WhatsApp Business App
quando desejar revogar a integração. O webhook de `PARTNER_REMOVED` confirma o
offboarding no WACRM.

## Página de exclusão

A URL pública é:

`https://crm.luizangelo.com.br/exclusao-de-dados`

Ela funciona sem login e orienta o titular a solicitar exclusão pelo canal de
privacidade. Nenhuma exclusão automática é executada ao apenas visitar a URL.

## Ordem de rollout futuro

1. Confirmar backup, migration gate e variáveis necessárias sem exibir seus
   valores.
2. Aplicar as duas migrations novas no banco WACRM correto.
3. Construir e implantar a imagem com as variáveis públicas de build e as
   variáveis server-only no serviço.
4. Validar health, login, configuração manual existente e HMAC do webhook.
5. Fazer um onboarding controlado e confirmar inscrição, sync e isolamento de
   tenant.
6. Só depois executar os passos manuais no painel Meta listados abaixo.

Não aplicar essas migrations antes do código correspondente estar pronto para
entrar no ar. Não reutilizar configuração, banco ou App Meta de outro produto.

## Passos manuais restantes na Meta

Após o deploy e a validação controlada, o administrador deve executar
manualmente no Meta Dashboard:

1. ativar os webhook fields `history`, `smb_app_state_sync` e
   `smb_message_echoes`;
2. avaliar e ativar `account_update` para o lifecycle/offboarding documentado;
3. atualizar a Data Deletion URL para
   `https://crm.luizangelo.com.br/exclusao-de-dados`;
4. concluir App Review/Advanced Access para
   `whatsapp_business_management` e `whatsapp_business_messaging`.

Essas ações não fazem parte da implementação no repositório.

## Diagnóstico

- **Configuração indisponível no frontend:** verificar presença das duas envs
  públicas no build e o carregamento permitido de `connect.facebook.net`.
- **Popup cancelado/fechado:** reiniciar o fluxo; não há code reutilizável.
- **`invalid_token`/`missing_permissions`:** conferir App ID, Config ID e
  Advanced Access sem copiar tokens para logs.
- **`invalid_waba`:** confirmar que a WABA concedida no onboarding está no
  acesso granular do token.
- **Seleção de número:** escolher somente entre candidatos revalidados pelo
  backend; sessão expira em dez minutos.
- **`subscription_not_confirmed`:** manter a conexão como não pronta e revisar
  permissões/inscrição no App.
- **Sync `delivery_unknown`:** não reenviar cegamente. Verificar webhooks e o
  estado na Meta antes de uma decisão manual.
- **Echo/history ausente:** verificar assinatura do field e logs sanitizados do
  webhook; nunca desabilitar HMAC para testar.
- **Verify do callback falha:** configurar o mesmo
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN` server-side e no callback Meta. Configurações
  manuais antigas mantêm fallback transitório ao token cifrado por account.

## Rollback

O rollback do aplicativo pode voltar à imagem anterior, mas as colunas novas e
a tabela de sessão devem permanecer: são aditivas e compatíveis com o fluxo
manual. Não executar down migration destrutiva. Enquanto o onboarding estiver
desabilitado, configurações já conectadas continuam atendidas pelo caminho
legado; configurações em coexistência devem permanecer preservadas para
investigação ou retomada segura.
