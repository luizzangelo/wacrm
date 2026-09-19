# Etapa 21F — auditoria multi-tenant / SaaS

> AUDITORIA HISTÓRICA. Os bloqueios abaixo foram corrigidos e testados em 21G.
> A produção separada foi SUPERADA pela decisão 21H de ambiente único.
> Não interpretar o NO-GO histórico como ausência das correções atuais, nem
> como autorização de lançamento: veja os novos findings em [21H](production-in-place-21h.md).

Resultado: **NO-GO PARA LANÇAMENTO**. Auditoria concluída; correções não
implementadas. Evidência coletada em 2026-09-17, America/Fortaleza, com fechamento
em 2026-09-18 UTC. Este resultado complementa 21C/21D/21E: backup restaurável não
comprova isolamento entre clientes.

## Premissa obrigatória de produção

Produção terá uma aplicação, stack `wacrm_production`, um Supabase de produção
compartilhado entre accounts e um worker lógico multi-account. Esse projeto será
separado do Supabase de staging. Não haverá projeto/banco por cliente. Dados
capturados do staging representarão somente o tenant existente; não poderão
impedir cadastro posterior de accounts 2, 3 e N. Um usuário pertence atualmente
a uma account por `profiles`; uma account pode ter vários usuários.

O domínio final continua `https://crm.luizangelo.com.br`. Sua utilização atual
pelo staging não o transforma em domínio definitivo de testes. Nenhuma produção,
DNS, conexão WhatsApp/Meta ou configuração remota foi criada/alterada nesta etapa.

## Método e limites da evidência

- Origem Supabase: consultas `BEGIN READ ONLY` por libpq; catálogo de tabelas,
  RLS, policies, constraints, índices, funções e buckets. Não houve dump novo,
  migration, criação de account, modificação de dados ou chamada Auth na origem.
- Código auditado no HEAD `22e013f`; sem diferença em `src`/migrations em relação
  ao commit da imagem `d638ff5`. Docker staging app e scheduler: 1/1 nessa imagem.
- Foram usados o PostgreSQL 17 local e o restore histórico já existente de 21D,
  sem novo restore. Rede IP proibida, somente socket Unix, sem app, scheduler,
  credenciais Meta ou serviços Auth/Storage. Dois tenants sintéticos A/B foram
  provisionados pelo trigger real de `auth.users` dentro de uma transação.
- Antes dos testes, todas as 43 funções públicas não extensionais capturadas,
  todas as policies públicas/Storage e todas as constraints públicas comparadas
  coincidiram exatamente entre origem e laboratório: zero drift.
- Foram registrados 72 casos/observações SQL. Chamadas como usuário autenticado
  usaram `SET LOCAL ROLE authenticated` e claims JWT sintéticos. Um caso adicional
  usou usuário sintético sem profile para avaliar o caminho de falha de bootstrap.
- Toda mutação local foi revertida. Contagens e fingerprints das 76 tabelas do
  laboratório permaneceram iguais antes/depois; cluster encerrado ao terminar.
- Suíte relevante existente: 13 arquivos, 317 testes aprovados. HTTP/Meta estavam
  simulados; testes PGlite não substituem os testes nativos de RLS/FKs acima.
- Não foram executados signup/login HTTP reais, fluxo visual de onboarding,
  envio WhatsApp/CAPI, leitura de bytes de outro tenant, nem corrida nativa com
  duas conexões nas RPCs de membership. Esses limites impedem certificar um
  lançamento end-to-end, mesmo nos componentes sem falha encontrada.

Evidência sanitizada: `saas-audit-21f.json` (0600), no diretório local do backup,
fora do Git. Não contém senhas, tokens, ctwa_clid real, hashes de PII ou PII real.
Não se leu/imprimiu `.pgpass`; libpq o utilizou internamente.

## Bloqueios comprovados

### F1 — associações cross-account aceitas pelo banco: CRÍTICO

Com caller A autenticado e UUIDs sintéticos conhecidos de B, o banco aceitou:

| Operação | Resultado nativo |
| --- | --- |
| Criar conversa de A com contato de B | 1 registro aceito |
| Criar nota de A para contato de B | 1 registro aceito |
| Vincular contato A a tag B | 1 vínculo aceito |
| Vincular contato A a campo personalizado B | 1 vínculo aceito |
| Responder em conversa A apontando para mensagem B | 1 mensagem aceita |
| Inserir contato B como recipient de broadcast A | 1 recipient aceito |
| Atribuir deal A ao UUID de profile B | 1 update aceito |

As policies verificam a account da linha ou apenas um dos pais; FKs simples
validam existência, não igualdade de account entre os recursos. A RLS protege
SELECT direto de B, mas não torna uma FK simples tenant-safe.

Referências: `supabase/migrations/017_account_sharing.sql`, policies de
conversations/contact_notes e tabelas de vínculo, especialmente linhas 488–540;
constraints reais do catálogo. Deals já têm `guard_deal_lifecycle`, que recusou
contact/pipeline estrangeiro; esse guard não protegeu `assigned_to`. Attributions
Meta têm FKs compostas e recusaram contato de B.

Impacto adicional por análise de código: a API por chave usa service-role e
`CONVERSATION_SELECT` com contato incorporado em
`src/app/api/v1/conversations/[id]/route.ts:26`; filtrar a conversa por account
não filtra o contato estrangeiro de um vínculo envenenado. O sender em
`src/lib/whatsapp/send-message.ts:225` também incorpora contato e usa seu telefone
sem comparar `contact.account_id` ao contexto. Com cliente service-role, isso
pode expor dados ou enviar para contato estrangeiro. O vínculo foi reproduzido;
esses efeitos HTTP/envio não foram executados.

Correção recomendada, não aplicada: invariantes tenant-safe para todos os vínculos
por FK composta/trigger adequado e WITH CHECK; validação defensiva dos pais e
assignees nos caminhos backend service-role. Não basta corrigir o formulário.

### F2 — notificação de A legível por B: CRÍTICO

Caller A conseguiu atribuir sua conversa a `user_id` B. O trigger
`notify_conversation_assigned()` inseriu notificação da account A dirigida a B;
caller B conseguiu lê-la: `visible = 1`. O trigger inclui identificação do
contato de A no texto. Foi um vazamento SQL reproduzido, não apenas hipótese.

`supabase/migrations/027_notifications.sql:40` seleciona por destinatário
`auth.uid() = user_id`, sem exigir membership da account da notificação.
`src/lib/flows/engine.ts:478` aceita `cfg.assign_to` sem checar account antes da
atribuição service-role, ampliando os caminhos para o mesmo problema.

Correção recomendada: exigir assignee pertencente à account da conversa/deal,
preservar essa invariante no banco e validar account também na policy/trigger de
notificações. Nenhuma correção executada.

### F3 — ingresso como owner via INSERT de profile órfão: CRÍTICO condicional

Para simular um usuário Auth cujo bootstrap falhou, removeu-se apenas seu profile
no laboratório. Esse caller autenticado conseguiu inserir seu próprio profile
com `account_id = B` e `account_role = owner`: 1 registro aceito.

`profiles_insert`, em `017_account_sharing.sql:617`, só exige
`auth.uid() = user_id`. O guard `enforce_profile_privilege_columns()` protege
mudanças em UPDATE, não autoriza a origem da membership no INSERT. A unique de
user_id bloqueia um segundo profile para usuário já provisionado, mas não o
usuário sem profile. Não foi reproduzida uma falha Auth remota: a condição foi
montada localmente e o INSERT explorável foi reproduzido.

Essa condição está relacionada ao comportamento real de `handle_new_user()`:
`EXCEPTION WHEN OTHERS` emite WARNING e retorna NEW, permitindo persistir usuário
Auth sem account/profile se o bootstrap falhar.

Correção recomendada: criação de membership apenas pelos caminhos privilegiados
autorizados; rejeitar INSERT arbitrário de role/account por usuário comum e
tornar o bootstrap fail-closed ou implementar recuperação segura e idempotente.
Nenhuma policy/trigger/Auth alterada nesta etapa.

### F4 — delivery statuses modificam mensagens sem account: ALTO

`src/app/api/whatsapp/webhook/route.ts:446` recebe phone_number_id, mas faz UPDATE
service-role de messages apenas por `message_id`. O próprio código/schema admite
message_id não único entre números. Com duas mensagens sintéticas A/B de mesmo
identificador, a reconstrução SQL exata desse UPDATE atingiu **2 accounts**.

Busca de broadcast recipient e fan-out subsequentes também não usam account;
fan-out escolhe arbitrariamente uma linha com `limit(1)`. Não foi enviado webhook
HTTP/Meta. O teste prova o comportamento do schema/query, não uma colisão observada
entre mensagens reais do staging.

Correção recomendada: resolver configuração/account por phone_number_id antes de
qualquer status e filtrar mensagens/recipients/fan-out pelo contexto proprietário;
número desconhecido deve ser ignorado também no ramo statuses. No ramo templates,
passar e validar contexto WABA/account de entry, hoje ausente na chamada ao handler.

### F5 — Storage não isola leitura entre accounts: CRÍTICO para o requisito

Os três buckets reais `avatars`, `chat-media` e `flow-media` estão `public=true`.
As policies SELECT permitem leitura por bucket sem membership. No laboratório,
A leu metadados do objeto sintético de B: `visible = 1`; deleção de B foi recusada.
Caller viewer conseguiu upload no path de sua account: 1 objeto aceito.

Uploads de chat/flow carregam account no path, mas isso não protege download de
bucket público. Avatars usam user no path. O runtime retorna `getPublicUrl` em
`src/lib/storage/upload-media.ts:130`; não foi encontrada implementação runtime
de signed URLs. A documentação oficial confirma que arquivos de bucket público
podem ser obtidos por quem possui a URL, sem autorização de leitura:
[Supabase — Storage Buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals).
Não se baixaram bytes nesta auditoria.

`src/app/api/whatsapp/media/[mediaId]/route.ts:81` responde com cache público e
não valida vínculo do media_id com recurso da account. É risco adicional de
autorização/cache identificado por código; exploração de cache não foi testada.

Correção recomendada: buckets privados, policies de membership/role completas,
download autenticado ou URLs assinadas de validade limitada; revisão de avatars,
paths legados e proxy de mídia. Compatibilidade das URLs usadas pela Meta deve ser
planejada; não trocar buckets/URLs silenciosamente.

### F6 — autorização de configuração antes de efeitos externos: ALTO

POST `src/app/api/whatsapp/config/route.ts:180` resolve account do usuário, mas
não exige admin no backend antes de `registerPhoneNumber` (315) e
`subscribeWabaToApp` (340). RLS bloqueia a gravação por agent/viewer, porém depois
dos possíveis efeitos externos. Alterações de templates também precisam revisão
equivalente de role antes das chamadas externas. Não houve chamada Meta para
reproduzir esse efeito nesta etapa: evidência é análise da ordem do código.

Correção recomendada: autorização explícita admin/owner antes de validação/
registro/subscrição ou edição externa, e ownership de todos os recursos usados.

### F7 — onboarding não é bootstrap completo e atômico: BLOQUEIO público

Signup chama Supabase Auth; trigger cria account dinâmica e profile owner. Dois
signups SQL sintéticos geraram duas accounts independentes e dois owners, sem
herdar contatos, conversas, deals, configs, tokens ou eventos do tenant existente.
Não existe restrição global de uma account; unique(owner_user_id) não é essa
restrição. A criação no caminho normal não exige SQL manual.

Entretanto, após o trigger: pipelines=0, WhatsApp configs=0 e Meta configs=0 para
ambos. WhatsApp começa não configurado/desconectado; Meta não configurada. Currency
default da account é USD, configurável, não BRL herdado do tenant atual.

O pipeline inicial só é criado ao abrir a página de pipelines por
`src/app/(dashboard)/pipelines/page.tsx:137`. Criação do pipeline e dos cinco
estágios normais não é transação única; erro da inserção dos estágios não é
verificado; trava por ref do componente não cobre concorrência entre abas/users.
Antes disso, inbound não dispõe de pipeline inicial para auto-deal. Cada pipeline
inserido recebe Venda perdida técnica via trigger. Mappings default são NULL;
Venda perdida permanece não mapeável. A interface oferece settings próprios de
WhatsApp e Meta, mas não um provisionamento servidor completo/idempotente.

Correção recomendada: definir onboarding servidor seguro, idempotente e atômico
para account/profile/pipeline/estágios/defaults, com estados explícitos para
configuração de integrações. Não herdar configurações ou mappings do staging.

## Cobertura de isolamento por recurso

Todas as 40 tabelas públicas inspecionadas têm RLS habilitada. A matriz abaixo não
declara seguro um recurso apenas porque seu SELECT básico foi bloqueado.

| Recurso | Evidência de isolamento básico | Resultado/contexto |
| --- | --- | --- |
| accounts | SELECT de B por A = 0 | Bootstrap/onboarding incompleto; owner pointer direto precisa teste adicional |
| profiles / membership equivalente | SELECT de B = 0; UPDATE direto de role/account negado | FAIL: INSERT de usuário sem profile admite owner em B |
| contacts | SELECT/DELETE B = 0; UPDATE B = 0 | Pai próprio protegido; vínculos estrangeiros aceitos |
| conversations | SELECT/DELETE B = 0 | FAIL: contact e assignee estrangeiros |
| messages | SELECT/DELETE B = 0 | FAIL: reply estrangeiro e UPDATE de status sem account |
| pipelines | SELECT/DELETE B = 0 | Contexto direto protegido; defaults/concurrency incompletos |
| pipeline_stages | SELECT/DELETE B = 0 | RLS por pipeline; mapping/lost guard existentes |
| deals | SELECT/DELETE B = 0; contact estrangeiro recusado | FAIL: assigned_to estrangeiro; demais lifecycle guards existentes |
| deal_loss_events | SELECT de outra account = 0 em A/B | Criação privilegiada e tenant context; não houve todas as mutações negativas |
| tags | SELECT/DELETE B = 0 | FAIL na associação com contato de outra account |
| custom_fields | SELECT/DELETE B = 0 | FAIL na associação com contato de outra account |
| automations | SELECT cruzado = 0 em A/B | RLS/account dispatch; corrida e vínculos de todos os filhos não certificados |
| flows | SELECT cruzado = 0 em A/B | FAIL no handoff sem validar assignee; demais filhos exigem regressão ampliada |
| broadcasts | SELECT cruzado = 0 em A/B | FAIL: recipient estrangeiro aceito |
| notifications | Notificações normais por destinatário | FAIL: B leu notificação pertencente a A |
| whatsapp_config | SELECT cruzado = 0 em A/B | Unique por account e phone; FAIL de role no backend antes de ação externa |
| meta_conversion_config | SELECT cruzado = 0 em A/B; reassociação negada | Config/credenciais por account; autorização admin no endpoint |
| meta_ad_attributions | SELECT cruzado = 0 em A/B; contact B recusado | FKs compostas protegem account dos vínculos |
| meta_conversion_events | SELECT cruzado = 0 em A/B; mutation cliente negada | Worker/contexto/unique por account corretos no escopo examinado |
| Storage | Delete objeto B negado; SELECT B permitido | FAIL: buckets públicos, metadata legível e viewer upload |

## Membership, WhatsApp, Meta e scheduler: pontos positivos e ressalvas

Roles existentes: owner/admin/agent/viewer. RPCs de convite/aceite/remoção/role/
transferência têm validação, locks e caminhos transacionais. Remover owner/self
foi recusado; RPC com alvo em B foi recusada; mudanças diretas de role/account por
UPDATE foram recusadas. Convite usa token hashed; aceite requer usuário autenticado
e move membership de account pessoal elegível. Remoção provisiona account pessoal;
transferência exige owner e membro do mesmo tenant. Isso não neutraliza F3. Não foi
certificada concorrência real de todos esses fluxos nem propriedade por todos os
caminhos diretos de UPDATE accounts; deve integrar o próximo teste de aceitação.

WhatsApp: unique(account_id), unique(phone_number_id), WABA/token/config por
account, token criptografado, sem fallback global para o número/token do staging.
O roteamento de **mensagens inbound** percorre entries/changes, resolve config por
phone_number_id e ignora desconhecido/ambíguo, sem account default. Esse ramo
isoladamente tem estrutura correta; statuses falham em F4. Exceção no decrypt de
uma config fora de um catch por tenant também pode abortar as entries seguintes,
risco de disponibilidade entre tenants. A assinatura global META_APP_SECRET é do
app Meta compartilhado, não credencial do WhatsApp de um cliente; apps Meta
independentes por tenant exigiriam desenho adicional de verificação.

Outbound: seleção das credenciais é por account da conversa, sem fallback global:
A → config A, B → config B. Isso recebe PASS estritamente para seleção de
credenciais, não para a integridade do destinatário/vínculo de F1.

Meta: Dataset, tokens, enabled, attribution e mappings são por account. Worker
`src/lib/meta-conversions/conversion-sender.ts:183–302` resolve event/config/
attribution/contact com account_id. WABA do payload vem do snapshot da attribution,
também account-scoped. Claim é UPDATE condicional de pending/attempts=0 para
sending/attempts=1 com id/account/status/attempts esperados. Unique de evento é
account_id + deal_id + event_name; event_id determinístico inclui account/deal.
Um claim perdedor não envia. Estados terminais não fazem retry.

Scheduler é um worker lógico multi-account, não um worker preso ao tenant atual.
Busca candidates id/account_id e captura erro por item para continuar os demais.
Testes de configs independentes, falha de um item e claim concorrente simulado
passaram. Batch é 5 por execução; intervalo atual 120s. Fairness/capacidade para
crescimento e claim concorrente nativo ainda precisam aceitação; PASS de lógica
não equivale a certificação de carga de SaaS público.

## Hardcodes e estado ativo

Não foram encontrados hardcodes tenant-specific no código runtime pesquisado.
Foram pesquisados WABA/Phone Number ID/Datasets conhecidos e IDs atuais de accounts
e pipelines obtidos apenas em memória, sem imprimi-los. Supabase staging ref e
domínio encontrados em configuração de ambiente/deploy/auth não são seleção de
tenant. Defaults de moeda/nomes de estágio não são IDs de cliente. Na inspeção
de nomes das variáveis Docker, não apareceu variável global de WABA/dataset/
phone/account/pipeline; nenhum valor secreto foi retornado.

Origem tem accounts=1, profiles=1, WhatsApp configs=1. São contagens atuais, não
restrições SaaS. Eventos Meta=8, pending=0, sending=0; não houve evento novo gerado
pela auditoria. Consultas de vínculos cruzados existentes retornaram 0, o que é
esperável em um banco com apenas uma account e não prova isolamento futuro.
App/scheduler 1/1. Nenhum cron manual, POST /events, Graph API ou envio foi feito.

## Relatório adicional solicitado

| Item | Resultado |
| --- | --- |
| Arquitetura multi-tenant | FAIL na aceitação end-to-end; modelo multi-account existe |
| Criação de nova account | BLOQUEADA para lançamento: bootstrap falível/defaults incompletos |
| Onboarding | BLOQUEADO |
| Convites/membership | FAIL: F3; RPCs guardadas não cobrem INSERT arbitrário |
| RLS cross-account | FAIL: F1/F2/F3 |
| WhatsApp por account | FAIL na autorização backend; schema/config por account PASS |
| Webhook por phone_number_id | FAIL end-to-end: statuses não respeitam contexto; inbound normal roteia corretamente |
| Outbound credentials por account | PASS na seleção; integridade dos vínculos/destinatários FAIL (F1) |
| Meta config por account | PASS no escopo auditado |
| Scheduler multi-account | PASS de lógica/claim simulado; carga/concorrência nativa ainda não certificadas |
| Storage isolation | FAIL |
| Hardcodes tenant-specific | NENHUM encontrado no escopo pesquisado |
| Nova account requer intervenção manual | NÃO no caminho normal; recuperação segura de falha não está pronta |
| Tenant B sintético testado | SIM, apenas laboratório local e rollback |
| SaaS ready | NÃO — NO-GO PARA LANÇAMENTO |

## Próxima ação proposta — não executada

Obter aprovação explícita das correções F1–F7 antes de implementar. Depois,
repetir regressão A/B com acessos autenticados reais, inserts/updates/deletes e
vínculos negativos em todos os recursos, Storage protegido, signup/onboarding,
aceite/removal/roles/ownership concorrentes, entries/statuses/templates A/B e
worker multi-account concorrente. Usar dados sintéticos, sem integrações reais.
Só um novo aceite sem FAIL cross-tenant permite reconsiderar o cutover.

Nesta etapa foram alterados apenas relatórios/runbooks locais. Os testes locais
revertidos não alteraram o restore histórico. Aplicação, migrations, staging,
Meta, Auth, Storage real, DNS e Shodisparo permaneceram intocados pelo agente.
