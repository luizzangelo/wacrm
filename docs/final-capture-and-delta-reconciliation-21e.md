# Etapa 21E — deltas e plano de captura final

> SUPERADO quanto ao plano de captura final/migração/freeze/cutover.
> A reconciliação histórica abaixo não foi reescrita. O ambiente existente
> tornou-se produção única por decisão posterior; bloqueios 21F foram tratados
> em 21G e reavaliados em [21H in-place](production-in-place-21h.md).

Estado: GO somente para PLANEJAR a captura final. Nenhum freeze, dump novo,
restore novo, produção, DNS, migration ou integração foi executado.
As categorias abaixo são recomendações, não decisões autorizadas de migração.

Gate posterior 21F: **NO-GO PARA LANÇAMENTO** por falhas cross-tenant comprovadas.
Produção será SaaS, com um único Supabase produtivo compartilhado entre accounts,
separado do staging; a migração atual representa somente o tenant existente.
Planejar captura continua permitido, mas executar cutover requer primeiro
correções autorizadas e novo aceite de isolamento/onboarding em
[21F — auditoria multi-tenant](saas-multi-tenant-audit-21f.md).

## Evidência e método

Comparação read-only em 2026-09-17, aproximadamente 21:49:32–21:49:34 UTC,
contra o banco histórico já restaurado na Etapa 21D. O laboratório existente
foi aberto com `default_transaction_read_only=on`, somente socket Unix e sandbox
sem rede IP; depois foi encerrado. Não foi restaurado/recriado novamente.
Fonte: transação REPEATABLE READ READ ONLY pelo service libpq de staging.
Ambos os lados foram renderizados com timezone UTC.

Todas as 76 tabelas foram comparadas por primary key e por coluna, usando HMAC
SHA-256 com uma chave aleatória de comparação, não persistida. Valores privados,
password hashes, tokens e PII não foram retornados; apenas assinaturas técnicas.
O resultado mede diferenças entre dois estados: não é um log de todas as ações
intermediárias, como insert seguido de delete ou update seguido de reversão.
Consultas estruturais posteriores confirmaram FKs, triggers, horários e status.
Evidência sanitizada e restrita: `reconciliation-21e.json` (0600), no diretório
do backup, fora do Git. O password file não foi lido/impresso pelo agente.

Dump histórico preservado em
`/Users/luizangelo/Backups/wacrm/staging/2026-09-17_145605/database.dump`.
SHA-256 revalidado nesta etapa: PASS. É um backup DR validado, não a futura
captura final de migração.

## Deltas por registro

| Tabela | Antes → agora | Inserts | Updates | Deletes | Colunas alteradas |
| --- | --- | ---: | ---: | ---: | --- |
| auth.refresh_tokens | 77 → 78 | 1 | 1 | 0 | revoked, updated_at |
| auth.sessions | 1 → 1 | 0 | 1 | 0 | updated_at, refreshed_at |
| auth.users | 1 → 1 | 0 | 1 | 0 | updated_at |
| public.deals | 3 → 2 | 0 | 0 | 1 | registro ausente |
| public.member_presence | 1 → 1 | 0 | 1 | 0 | last_seen_at |
| public.meta_conversion_events | 8 → 8 | 0 | 1 | 0 | deal_id, updated_at |

Total: 6 tabelas alteradas, 1 insert, 5 updates, 1 delete; outras 70 iguais
por registro/coluna, não apenas por contagem. Identidades Auth e password hash
não mudaram. Usuário atualizado às 18:07:31.101139 UTC; refresh novo criado às
18:07:31.097532; refresh anterior revogado às 18:07:31.085109; sessão atualizada
às 18:07:31.124774. Padrão compatível com renovação de sessão, não criação de
novo usuário. Presença atualizada às 18:13:43.944894 UTC.

### Deal ausente: causa comprovada e limite da prova

ID sanitizado `8f688710…`, pipeline Comercial, estágio Venda perdida, sem
atribuição congelada. Criado em 2026-09-17T05:07:07.477690Z; último update no
backup em 06:15:00.177914Z. Os outros dois deals mantêm IDs e conteúdo iguais.
Não é uma mudança de estágio/status nem um problema no restore: o registro
presente no histórico está fisicamente ausente do staging atual.

O seu LeadSubmitted histórico continua `skipped_no_attribution`, attempts=0,
sent_at=NULL. Apenas `deal_id` virou NULL e `updated_at` mudou para
2026-09-17T18:08:00.390845Z (15:08:00.390845 em Fortaleza).
FK `meta_conversion_events_deal_account_fkey`:
`FOREIGN KEY (deal_id, account_id) REFERENCES deals(id, account_id) ON DELETE SET NULL (deal_id)`.
Trigger `set_updated_at` executa `update_updated_at_column()` nesse UPDATE.
O timestamp é o do efeito transacional registrado no evento, não prova da hora
exata de commit nem identificação do operador.

Isso comprova uma exclusão com preservação do evento histórico por SET NULL.
Account, pipeline, user, contacts e demais pais relevantes não foram removidos
nos estados comparados; não há evidência de perda por cascade de um desses pais.
O aplicativo oferece exclusão direta por Supabase em
`src/components/pipelines/deal-form.tsx`, função `handleDelete`.
Isso é um caminho possível, não prova de que foi o caminho usado neste caso.

`deal_loss_events` continua com 1 registro idêntico; só tem FK para account,
não FK/cascade para deal. A ocorrência histórica de perda foi preservada.
Logs do app consultados entre 18:00 e 18:15 UTC: nenhuma linha retornada.
auth.audit_log_entries: 0. Não existe evidência consultada que permita atribuir
autor, motivo ou confirmar se a exclusão foi uma ação legítima autorizada.
Não restaurar/recriar esse deal automaticamente.

## Auth, Meta, WhatsApp e Storage

- Auth: users=1, identities=1, sessions=1, refresh_tokens=78; mfa_factors,
  mfa_challenges, recovery sets/codes e WebAuthn credentials/challenges=0;
  mfa_amr_claims=1 e flow_state=5. Identidade persistente é diferente de sessão.
  Recomendar preservação de users/identities e revisão de fatores/mapeamentos;
  não transportar sessões/tokens. Login novo no projeto separado, sem reutilizar
  automaticamente chaves JWT. Preservar UUIDs quando a migração for aprovada,
  para manter referências públicas. Não decidiu nem executou migração Auth.
- Meta: attributions=2, config=1, events=8; sent=6, failed=1,
  skipped_no_attribution=1; pending=0, sending=0. IDs/event_ids, statuses,
  attempts e sent_at permanecem iguais ao histórico. O único update é o SET
  NULL descrito acima. Preservar estados terminais e event_ids; não reabrir,
  resetar attempts ou reenviar. Worker seleciona pending/attempts=0; failed,
  sent e delivery_unknown não são retry. Manter scheduler produtivo desligado
  até validação de importação/filas, inclusive das demais automações.
- WhatsApp: 1 config, connected, Phone Number ID/WABA/token presentes; registro
  inteiro inalterado. Ciphertext tem 3 componentes do formato GCM atual.
  Nenhum token foi descriptografado. Cópia de ciphertext requer a MESMA
  ENCRYPTION_KEY (AES-256-GCM); uma chave nova não lê esses dados. A configuração
  criptografada pode ser herdada após revisão autorizada, mas o vínculo ativo
  de webhook/sender nunca deve operar simultaneamente nos dois ambientes.
- Storage: buckets=3 (avatars, chat-media, flow-media), objects=1; único objeto
  em avatars, image/png, 392255 bytes. Metadados e chave do objeto inalterados
  por comparação de todas as colunas: 0 novos, 0 removidos, 0 modificados em
  metadata. Sem download/HEAD novo nesta etapa. Não afirmar nova validação dos
  bytes remotos: a evidência de bytes/checksum é a captura validada em 21D.
  Captura final deverá recapturar os bytes e validar checksums sob freeze.

## Classificação das 76 tabelas — recomendação, não execução

Classificação não manda excluir dados do backup. O dump DR integral deve
preservar tudo. Exclusões/reconfigurações no destino exigem plano de importação
aprovado, coerente com FKs e versões dos schemas gerenciados. Não executar um
restore integral em produção e ligar os serviços sem revisar estados ativos.

### A — MIGRAR: 28 tabelas

Dados permanentes e históricos, preservando IDs/referências/estados:

- public.accounts
- public.ai_knowledge_chunks
- public.ai_knowledge_documents
- public.ai_usage_log
- public.automation_logs
- public.automation_steps
- public.automations
- public.contact_custom_values
- public.contact_notes
- public.contact_tags
- public.contacts
- public.conversations
- public.custom_fields
- public.deal_loss_events
- public.deals
- public.flow_nodes
- public.flow_run_events
- public.flows
- public.message_reactions
- public.messages
- public.meta_ad_attributions
- public.meta_conversion_events
- public.pipeline_stages
- public.pipelines
- public.profiles
- public.quick_replies
- public.tags
- supabase_migrations.schema_migrations

Automations/flows preservam definição; não ativar executores antes de revisar
gatilhos/filas. Ledger do aplicativo deve ser reconciliado, não reaplicado
cegamente: 47 migrations atuais iguais ao histórico, incluindo hardening 21B.
Colunas de lock/claim/cooldown em dados permanentes exigem revisão no destino,
sem descartar conversations/messages por conterem estado operacional.

### B — MIGRAR COM REVISÃO: 20 tabelas

- auth.audit_log_entries — histórico de segurança, não sessão descartável.
- auth.identities — preservar vínculos; revisar providers/UUIDs.
- auth.mfa_factors — identidade persistente; compatibilidade e proteção.
- auth.mfa_recovery_code_sets — compatibilidade com usuários/fatores.
- auth.mfa_recovery_codes — segredos de recuperação, sem exposição.
- auth.oauth_consents — consentimentos persistentes; clients do destino.
- auth.scim_users — revisar mapeamento com provider do destino.
- auth.users — identidade/passwords persistentes; nova configuração Auth.
- auth.webauthn_credentials — revisar RP ID/domínio/fatores.
- public.account_invitations — revisar convites/token/validade/URLs.
- public.ai_configs — credenciais, habilitação e efeitos externos.
- public.automation_pending_executions — intenção pendente durável; não executar automaticamente.
- public.broadcast_recipients — histórico e progresso; não duplicar envio.
- public.broadcasts — definição/histórico e estado de execução.
- public.flow_runs — progresso/esperas; decidir retomada por execução.
- public.message_templates — reconciliar com WABA/provedor, sem chamar Meta aqui.
- public.meta_conversion_config — Dataset/tokens/ENCRYPTION_KEY/enable por ambiente.
- public.notifications — histórico/unread/retention de operadores.
- public.whatsapp_config — ciphertext/chave e consumidor único.
- storage.objects — metadata deve acompanhar os bytes; plano suportado de importação Storage.

### C — NÃO MIGRAR: 13 tabelas

Sessões/estado transitório. Aceitar no snapshot DR; recomendar omissão no
payload de migração produtiva aprovado, não apagar da origem:

- auth.flow_state
- auth.mfa_amr_claims
- auth.mfa_challenges
- auth.oauth_authorizations
- auth.oauth_client_states
- auth.one_time_tokens
- auth.refresh_tokens
- auth.saml_relay_states
- auth.sessions
- auth.webauthn_challenges
- public.member_presence
- storage.s3_multipart_uploads
- storage.s3_multipart_uploads_parts

Uma multipart upload em andamento não pode ser descartada durante operação:
finalizar/abortar por procedimento autorizado ANTES da captura. Atualmente 0.
Não confundir automation_pending_executions/flow_runs/broadcasts com cache:
podem representar intenção durável e ficam em B.

### D — RECRIAR/RECONCILIAR NO DESTINO: 15 tabelas

- auth.custom_oauth_providers
- auth.instances
- auth.oauth_clients
- auth.saml_providers
- auth.schema_migrations
- auth.scim_tokens
- auth.sso_domains
- auth.sso_providers
- public.api_keys
- public.webhook_endpoints
- storage.buckets
- storage.buckets_analytics
- storage.buckets_vectors
- storage.migrations
- storage.vector_indexes

Recriar/reconciliar configurações com IDs/referências compatíveis; não copiar
blindamente histories gerenciados auth/storage para um projeto de versão
diferente. Buckets devem reproduzir políticas/publicidade/limites e nomes,
via interfaces suportadas. Secrets novos por ambiente, salvo a chave exigida
para ler ciphertext legado. Config fora das tabelas: Supabase Auth Site URL,
redirect allowlist/SMTP/providers, JWT signing keys, API keys, ENCRYPTION_KEY,
secrets Meta/cron, webhook/assinatura, Realtime/publications, domínio/Traefik,
scheduler interno e demais serviços. Nenhum valor secreto foi inventariado em
texto ou nenhum ajuste executado.

## Plano de freeze — SOMENTE proposta

Orçamento preliminar: 15–20 minutos para CAPTURA e validação rápida, não SLA.
Dump histórico levou 66.757s (855768 bytes); Storage atual 392255 bytes/1 objeto.
O tamanho é pequeno, mas drenar writes, confirmar bloqueios e validar
consistência domina a janela. Reservar até 30 minutos antes de abortar/reavaliar
o plano, com critério aprovado; erro em captura/validação exige parar e reportar.
Restore, aceitação de produção, DNS/webhook e rollback podem prolongar downtime
além desse orçamento. Preparação não feita e transferência externa não medida.

Sequência a aprovar antes de executar:

1. Manutenção e bloqueio efetivo de writes: operadores/deals/CRM, APIs públicas,
   direct Supabase REST/RPC, Auth (login, refresh, recovery/signup/updates),
   uploads/deletes Storage, service-role clients, integrações e jobs externos.
   Não alegar que parar Next.js congela Supabase. Definir controle suportado
   para cada caminho; ainda não foi validado um gate de manutenção completo.
2. Parar somente `wacrm_staging_meta_conversions_scheduler` e outros executores
   staging inventariados (automations, broadcasts, flows, AI/background jobs).
   Não tocar Shodisparo, Traefik compartilhado ou serviços de outros projetos.
   Drenar requisição já em andamento, sem retry e sem converter sending em pending.
3. Bloquear ingresso WhatsApp antes de drenar/parar app; responder 503/não-2xx
   no host/path específico para permitir retry do provedor. Nunca responder
   200 descartando eventos. Não alterar Meta. Definir janela/reentrega/dedup e
   consumidor único futuro; retry/replay real só em etapa autorizada.
4. Confirmar ausência de writes/transactions em andamento, fila pending/sending
   em estado aprovado, nenhum upload multipart ativo e exclusividade de writer.
   Inventariar jobs internos/provider-managed e credenciais ainda capazes de
   escrever; verificar estabilidade com duas leituras de tabelas críticas.
   Se não for possível garantir o gate, NO-GO para a execução da captura.
5. Criar dump FINAL em NOVO diretório privado aprovado. Coordenar inventário
   com pg_export_snapshot/pg_dump --snapshot ou manter freeze completo e provar
   estabilidade antes/depois. Não sobrescrever backup histórico.
6. Copiar bytes Storage separadamente sob o MESMO freeze; inventário de todas
   as chaves/buckets/metadados; preservar paths, tamanho e content type.
7. SHA-256 de dump e objetos; reread local e validação de integridade.
8. pg_restore --list e comparação de TOC/schema esperado. Parar se houver erro.
9. Conferir contagens e assinaturas por registro, ledger/hardening, Auth apenas
   indicadores privados, Storage metadata vs bytes, eventos e estados terminais.
10. Manter staging congelado durante restore/aceite/cutover quando a captura
    for usada como FINAL. Se reabrir writes antes do cutover, o snapshot volta
    a ser histórico e uma nova captura/reconciliação autorizada será necessária.

App pode ser drenado e parado após gates, somente nesta stack. Login/refresh
precisam de bloqueio porque escrevem usuários/sessões/tokens mesmo sem editar
um contato. Jobs de housekeeping Auth podem escrever independentemente do app:
procedimento suportado pelo provedor e escopo de consistência precisam ser
definidos; não tentar editar tabelas/roles gerenciadas improvisadamente.

## Estratégias de captura final (diferentes da Topologia B aprovada)

| Estratégia | Prós | Riscos/contras | Consistência e rollback |
| --- | --- | --- | --- |
| A: preparar produção isolada primeiro, depois freeze/captura/restore | Pré-validar versão, roles, Auth, Storage, capacidade e gates; menor janela | Custo/preparação antecipados; risco de integração acidental | Destino sem ingress/egress e scheduler desligado; staging congelado até aceite |
| B: freeze/captura antes de criar produção | Captura pronta antes do investimento | Downtime inclui provisionamento/preparação; reabrir staging invalida caráter final | Ou manter origem congelada por janela longa, ou recapturar após reabertura; retorno simples antes de writes produtivos |

Recomendação técnica explícita: A, pendente de decisão/autorização do usuário.
Isso NÃO muda a Topologia B já escolhida (produção separada).
Produção futura: `https://crm.luizangelo.com.br`, `wacrm_production`, novo
Supabase e scheduler separados. Staging permanece `wacrm_staging` /
`awganmhowivedfocwzjy`, domínio futuro indefinido. DNS atual intocado.

Rollback antes de writes produtivos: destino permanece isolado, retirar gates
de staging e retomar uma única ingestão/scheduler conforme aprovação. Após
writes produtivos, rollback exige reconciliação reversa; não restaurar snapshot
antigo por cima de dados novos nem gerar envios duplicados. DNS/webhook não
serão modificados nesta etapa e precisam de plano futuro explícito.

## Saúde e bloqueios para execução futura

Leitura VPS: app=1/1 e scheduler=1/1, imagem `wacrm-staging:d638ff5`.
Scheduler 120000ms: nove execuções entre 21:35:52 e 21:51:52 UTC;
HTTP 200, processed=0 nas entradas consultadas. Leitura final: deals=2,
attributions=2, events=8, pending=0 e sending=0, com statuses preservados.
Nenhum cron manual, Graph/Meta/WhatsApp request ou POST /events feito pelo agente.
O scheduler automático permaneceu ativo, sem alterações nesta etapa.

GO para planejamento, não para freeze/prod/cutover. Pendências:

- Aprovar estratégia A/B de CAPTURA, janela, responsáveis e critério de abort.
- Aprovar política por tabela/retention/importação e confirmar intenção da
  exclusão do deal; autoria não é recuperável com a evidência consultada.
- Definir e validar gates completos (app, direct Supabase Auth/REST/RPC/Storage,
  credenciais/jobs), drenagem e retry do webhook, sem efeitos externos nos testes.
- Plano suportado de restore entre projetos gerenciados/roles/extensões/Auth/
  Storage, mapeamentos, novas URLs/JWT/keys e chave de ciphertext legado.
- Preparar destino isolado SOMENTE após nova autorização; nenhuma infraestrutura
  produtiva foi criada. Aprovar futuro cutover de consumidor único, domínio
  staging e rollback pós-writes. Não reenviar eventos históricos.

Referências oficiais consultadas (orientações Supabase):

- [Migração entre projetos](https://supabase.com/docs/guides/platform/migrating-within-supabase)
- [Migração Auth users e validade de tokens](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects)
- [Changelog](https://supabase.com/changelog)

A orientação Supabase determinou a separação users/identities vs sessions/tokens,
configs gerenciadas vs ledger aplicativo, e SQL metadata vs bytes Storage.
