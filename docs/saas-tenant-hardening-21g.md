# Etapa 21G — isolamento SaaS no staging

Estado: correções, reaudit A/B, migration e deploy aceitos em 2026-09-18.
Escopo exclusivo: Supabase awganmhowivedfocwzjy, stack wacrm_staging.
Nenhuma criação de produção, alteração de DNS, freeze, Meta externa ou Shodisparo.

## Decisões e defesa em profundidade

Uma aplicação, múltiplas accounts; uma whatsapp_config/número por account.
Unicidade de account_id e phone_number_id preservada; WABA não é unique.
Não há tenant global/default: inbound/status resolvem exclusivamente o Phone Number ID.
Lookup inicial por API key hash e convite hash é autenticação, não fallback de account.

Nove children recebem account_id NOT NULL derivada do pai. Trinta e seis relações
recebem composite FK, preservando nomes antigos para embeds PostgREST não ambíguos.
A conta de recursos é imutável inclusive para service_role. Assignees/recipients
mutáveis precisam de membership na mesma account; a saída limpa assignments/presence.
user_id/created_by históricos são autoria/auditoria, não autorização, e não são
reassociados nem apagados quando o autor deixa a equipe.

RLS anterior é mantido onde já era correto. INSERT/DELETE de profiles pelo browser
são revogados; account/membership somente via RPC oficial transacional ou convite.
Notifications exigem account membership E recipient auth.uid, inclusive UPDATE
WITH CHECK. Realtime assina INSERT/UPDATE filtrados; não assina DELETE sem isolamento.
Filas internas sem policy browser permanecem deny-by-default/service-only.

Signup e recuperação de profile criam account + owner + pipeline e estágios
atomicamente, sem catch que esconda falhas. Defaults possuem mappings NULL e Venda
perdida técnica. WhatsApp ausente significa desconectado, Meta ausente significa
desabilitado; nenhuma credencial de outra conta é copiada. Convite pode descartar
apenas conta pessoal realmente vazia e defaults nunca personalizados.
RPC de recovery é idempotente e não recebe account_id ou role. Execuções concorrentes
do mesmo usuário são serializadas por advisory lock; convite é bloqueado/uso único.
RPCs de roles/ownership da 21B continuam guardadas e serializadas.

## Matriz de ownership

Inventário capturado antes das mudanças: 40 tabelas públicas, todas com RLS ativo.
A coluna parent abaixo descreve FKs; Auth é identidade global, não pai tenant.
As operações impossíveis ao browser são negadas por grants/RLS, não liberadas
artificialmente para satisfazer CRUD. WHERE por ID pode ser equivalente quando
ID veio de recurso já autorizado, imutável e FK composite; IDs de request nunca
são tratados como autorização para cliente privilegiado.

| table | tenant_key atual | parent / FKs | RLS | proteção estrutural | callers inventariados |
| --- | --- | --- | --- | --- | --- |
| profiles | account_id | auth.users(id), accounts(id) | Ativo; operações por role | RPC, grants restritos | src/app/(dashboard)/inbox/page.tsx; src/app/api/account/members/route.ts; src/app/api/ai/config/route.ts; src/app/api/automations/route.ts; src/app/api/flows/route.ts; src/app/api/whatsapp/config/route.ts; src/app/api/whatsapp/config/verify-registration/route.ts; src/app/api/whatsapp/media/[mediaId]/route.ts; src/app/api/whatsapp/templates/[id]/route.ts; src/components/inbox/message-thread.tsx; src/components/pipelines/deal-form.tsx; src/components/settings/profile-form.tsx; src/hooks/use-auth.tsx; src/lib/auth/account.ts; src/lib/automations/engine.ts; src/lib/storage/upload-media.ts |
| tags | account_id | auth.users(id), accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/(dashboard)/broadcasts/new/page.tsx; src/app/(dashboard)/contacts/page.tsx; src/components/automations/automation-builder.tsx; src/components/broadcasts/step2-select-audience.tsx; src/components/broadcasts/step4-schedule-send.tsx; src/components/contacts/contact-detail-view.tsx; src/components/contacts/contact-form.tsx; src/components/contacts/import-modal.tsx; src/components/inbox/contact-sidebar.tsx; src/components/inbox/conversation-list.tsx; src/components/settings/settings-overview.tsx; src/components/settings/settings-sections.ts; src/components/settings/tag-manager.tsx; src/hooks/use-broadcast-sending.ts; src/lib/api/v1/contacts.ts; src/lib/contacts/parse-contact-csv.ts; src/lib/contacts/resolve-import-tags.ts; src/lib/contacts/tag-write.ts |
| contacts | account_id | auth.users(id), accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/(dashboard)/contacts/page.tsx; src/app/(dashboard)/pipelines/page.tsx; src/app/api/v1/contacts/[id]/route.ts; src/app/api/v1/contacts/route.ts; src/app/api/whatsapp/send/route.ts; src/app/api/whatsapp/webhook/route.ts; src/components/broadcasts/step2-select-audience.tsx; src/components/broadcasts/step3-personalize.tsx; src/components/broadcasts/step4-schedule-send.tsx; src/components/contacts/contact-detail-view.tsx; src/components/contacts/contact-form.tsx; src/components/contacts/import-modal.tsx; src/components/layout/header.tsx; src/components/layout/sidebar.tsx; src/components/pipelines/deal-form.tsx; src/hooks/use-broadcast-sending.ts; src/lib/api/v1/contacts.ts; src/lib/api/v1/pagination.ts; src/lib/automations/engine.ts; src/lib/automations/meta-send.ts; src/lib/contacts/dedupe.ts; src/lib/contacts/tag-write.ts; src/lib/dashboard/queries.ts; src/lib/flows/engine.ts; src/lib/flows/meta-send.ts; src/lib/meta-conversions/conversion-sender.ts; src/lib/meta-conversions/event-diagnostics.ts; src/lib/whatsapp/resolve-conversation.ts; src/lib/whatsapp/send-message.ts |
| contact_tags | account_id (derivada no banco) | contacts(id), tags(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/(dashboard)/contacts/page.tsx; src/components/broadcasts/step2-select-audience.tsx; src/components/broadcasts/step4-schedule-send.tsx; src/components/contacts/contact-detail-view.tsx; src/components/inbox/contact-sidebar.tsx; src/hooks/use-broadcast-sending.ts; src/lib/api/v1/contacts.ts; src/lib/automations/engine.ts; src/lib/contacts/resolve-import-tags.ts; src/lib/contacts/tag-write.ts; src/lib/flows/engine.ts |
| custom_fields | account_id | auth.users(id), accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/components/automations/automation-builder.tsx; src/components/broadcasts/step2-select-audience.tsx; src/components/broadcasts/step3-personalize.tsx; src/components/contacts/contact-detail-view.tsx; src/components/contacts/custom-fields-manager.tsx; src/components/settings/settings-overview.tsx; src/lib/automations/engine.ts |
| contact_notes | account_id | contacts(id), auth.users(id), accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/components/contacts/contact-detail-view.tsx; src/components/inbox/contact-sidebar.tsx |
| contact_custom_values | account_id (derivada no banco) | contacts(id), custom_fields(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/components/broadcasts/step2-select-audience.tsx; src/components/broadcasts/step3-personalize.tsx; src/components/contacts/contact-detail-view.tsx; src/hooks/use-broadcast-sending.ts; src/lib/automations/engine.ts |
| meta_conversion_config | account_id | accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/lib/meta-conversions/config.ts; src/lib/meta-conversions/conversion-sender.ts; src/lib/meta-conversions/enrichment.ts; src/lib/meta-conversions/event-diagnostics.ts |
| message_templates | account_id | auth.users(id), accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/api/whatsapp/templates/[id]/route.ts; src/app/api/whatsapp/templates/submit/route.ts; src/app/api/whatsapp/templates/sync/route.ts; src/components/automations/automation-builder.tsx; src/components/broadcasts/step1-choose-template.tsx; src/components/inbox/template-picker.tsx; src/components/settings/settings-overview.tsx; src/components/settings/template-manager.tsx; src/lib/whatsapp/template-body.ts; src/lib/whatsapp/template-webhook.ts |
| meta_conversion_events | account_id | accounts(id), deals(id,, contacts(id,, meta_ad_attributions(id,, pipeline_stages(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/lib/meta-conversions/conversion-sender.ts; src/lib/meta-conversions/event-diagnostics.ts |
| conversations | account_id | auth.users(id), contacts(id), accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/(dashboard)/inbox/page.tsx; src/app/(dashboard)/pipelines/page.tsx; src/app/api/ai/autoreply/[conversationId]/route.ts; src/app/api/ai/draft/route.ts; src/app/api/v1/conversations/[id]/messages/route.ts; src/app/api/v1/conversations/[id]/route.ts; src/app/api/v1/conversations/route.ts; src/app/api/whatsapp/react/route.ts; src/app/api/whatsapp/send/route.ts; src/app/api/whatsapp/webhook/route.ts; src/components/inbox/conversation-list.tsx; src/components/inbox/message-thread.tsx; src/components/pipelines/deal-form.tsx; src/hooks/use-realtime.ts; src/hooks/use-total-unread.ts; src/lib/ai/auto-reply.ts; src/lib/automations/engine.ts; src/lib/automations/meta-send.ts; src/lib/conversations/reopen.ts; src/lib/dashboard/queries.ts; src/lib/flows/engine.ts; src/lib/flows/meta-send.ts; src/lib/whatsapp/resolve-conversation.ts; src/lib/whatsapp/send-message.ts |
| meta_ad_attributions | account_id | accounts(id), contacts(id,, conversations(id,, whatsapp_config(id, | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/lib/meta-conversions/attribution-view.ts; src/lib/meta-conversions/attribution.ts; src/lib/meta-conversions/conversion-sender.ts; src/lib/meta-conversions/enrichment.ts; src/lib/meta-conversions/event-diagnostics.ts |
| messages | account_id (derivada no banco) | conversations(id), messages(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/api/v1/conversations/[id]/messages/route.ts; src/app/api/whatsapp/react/route.ts; src/app/api/whatsapp/webhook/route.ts; src/components/inbox/message-thread.tsx; src/hooks/use-realtime.ts; src/lib/ai/context.ts; src/lib/automations/meta-send.ts; src/lib/dashboard/queries.ts; src/lib/flows/engine.ts; src/lib/flows/meta-send.ts; src/lib/whatsapp/send-message.ts |
| whatsapp_config | account_id | auth.users(id), accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/(dashboard)/inbox/page.tsx; src/app/api/whatsapp/broadcast/route.ts; src/app/api/whatsapp/config/route.ts; src/app/api/whatsapp/config/verify-registration/route.ts; src/app/api/whatsapp/media/[mediaId]/route.ts; src/app/api/whatsapp/react/route.ts; src/app/api/whatsapp/templates/[id]/route.ts; src/app/api/whatsapp/templates/submit/route.ts; src/app/api/whatsapp/templates/sync/route.ts; src/app/api/whatsapp/webhook/route.ts; src/components/settings/settings-overview.tsx; src/components/settings/whatsapp-config.tsx; src/lib/api/v1/contacts.ts; src/lib/automations/meta-send.ts; src/lib/flows/meta-send.ts; src/lib/meta-conversions/config.ts; src/lib/whatsapp/broadcast-core.ts; src/lib/whatsapp/broadcast-resume.ts; src/lib/whatsapp/resolve-conversation.ts; src/lib/whatsapp/send-message.ts |
| broadcast_recipients | account_id (derivada no banco) | broadcasts(id), contacts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/(dashboard)/broadcasts/[id]/page.tsx; src/app/api/whatsapp/webhook/route.ts; src/hooks/use-broadcast-sending.ts; src/lib/whatsapp/broadcast-core.ts; src/lib/whatsapp/broadcast-resume.ts |
| pipelines | account_id | auth.users(id), accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/(dashboard)/pipelines/page.tsx; src/components/automations/automation-builder.tsx; src/components/layout/header.tsx; src/components/layout/sidebar.tsx; src/components/pipelines/pipeline-settings.tsx; src/lib/meta-conversions/event-diagnostics.ts |
| broadcasts | account_id | auth.users(id), accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/(dashboard)/broadcasts/[id]/page.tsx; src/app/(dashboard)/broadcasts/new/page.tsx; src/app/(dashboard)/broadcasts/page.tsx; src/app/api/v1/broadcasts/[id]/route.ts; src/components/layout/header.tsx; src/components/layout/sidebar.tsx; src/hooks/use-broadcast-sending.ts; src/lib/dashboard/queries.ts; src/lib/whatsapp/broadcast-core.ts; src/lib/whatsapp/broadcast-resume.ts |
| pipeline_stages | account_id (derivada no banco) | pipelines(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/(dashboard)/pipelines/page.tsx; src/components/automations/automation-builder.tsx; src/components/pipelines/pipeline-settings.tsx; src/lib/dashboard/queries.ts; src/lib/meta-conversions/event-diagnostics.ts |
| automations | account_id | auth.users(id), accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/(dashboard)/automations/[id]/logs/page.tsx; src/app/(dashboard)/automations/page.tsx; src/app/api/automations/[id]/duplicate/route.ts; src/app/api/automations/[id]/route.ts; src/app/api/automations/route.ts; src/components/layout/header.tsx; src/components/layout/sidebar.tsx; src/lib/ai/auto-reply.ts; src/lib/automations/engine.ts |
| automation_steps | account_id (derivada no banco) | automations(id), automation_steps(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/api/automations/[id]/duplicate/route.ts; src/lib/automations/engine.ts; src/lib/automations/steps-tree.ts |
| message_reactions | account_id (derivada no banco) | messages(id), conversations(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/api/whatsapp/react/route.ts; src/app/api/whatsapp/webhook/route.ts; src/components/inbox/message-thread.tsx |
| automation_logs | account_id | automations(id), auth.users(id), contacts(id), accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/(dashboard)/automations/[id]/logs/page.tsx; src/lib/automations/engine.ts; src/lib/dashboard/queries.ts |
| automation_pending_executions | account_id | automations(id), auth.users(id), contacts(id), automation_logs(id), automation_steps(id), accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/api/automations/cron/route.ts; src/lib/automations/engine.ts |
| flows | account_id | auth.users(id), accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/api/flows/[id]/activate/route.ts; src/app/api/flows/[id]/route.ts; src/app/api/flows/[id]/runs/route.ts; src/app/api/flows/route.ts; src/components/layout/sidebar.tsx; src/lib/flows/engine.ts |
| accounts | id | auth.users(id) | Ativo; operações por role | owner RPC | src/app/api/account/route.ts; src/components/settings/deals-settings.tsx; src/hooks/use-auth.tsx; src/lib/api/v1/contacts.ts; src/lib/api-keys/store.ts; src/lib/auth/account.ts; src/lib/automations/engine.ts |
| flow_run_events | account_id (derivada no banco) | flow_runs(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/api/flows/[id]/runs/route.ts; src/app/api/flows/cron/route.ts; src/lib/flows/engine.ts |
| flow_nodes | account_id (derivada no banco) | flows(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/api/flows/[id]/activate/route.ts; src/app/api/flows/[id]/route.ts; src/app/api/flows/route.ts; src/lib/flows/engine.ts |
| account_invitations | account_id | accounts(id), auth.users(id), auth.users(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/api/account/invitations/[id]/route.ts; src/app/api/account/invitations/route.ts |
| flow_runs | account_id | contacts(id), conversations(id), messages(id), flows(id), auth.users(id), accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/api/flows/[id]/runs/route.ts; src/app/api/flows/cron/route.ts; src/lib/flows/engine.ts; src/lib/whatsapp/send-message.ts |
| member_presence | account_id | auth.users(id), accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/hooks/use-presence.ts |
| api_keys | account_id | accounts(id), auth.users(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/api/account/api-keys/[id]/route.ts; src/app/api/account/api-keys/route.ts; src/lib/api-keys/store.ts |
| notifications | account_id | accounts(id), auth.users(id), conversations(id), contacts(id), auth.users(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/(dashboard)/notifications/page.tsx; src/components/layout/header.tsx; src/components/layout/sidebar.tsx; src/hooks/use-unread-notifications.ts |
| webhook_endpoints | account_id | accounts(id), auth.users(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/api/v1/webhooks/[id]/route.ts; src/app/api/v1/webhooks/route.ts; src/lib/webhooks/deliver.ts |
| ai_knowledge_documents | account_id | accounts(id), auth.users(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/api/ai/knowledge/[id]/route.ts; src/app/api/ai/knowledge/reindex/route.ts; src/app/api/ai/knowledge/route.ts |
| ai_knowledge_chunks | account_id | ai_knowledge_documents(id), accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/lib/ai/knowledge.ts |
| ai_configs | account_id | accounts(id), auth.users(id), auth.users(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/api/ai/config/route.ts; src/lib/ai/config.ts |
| ai_usage_log | account_id | accounts(id), conversations(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/api/ai/usage/route.ts; src/lib/ai/usage.ts |
| quick_replies | account_id | accounts(id), auth.users(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/api/quick-replies/[id]/route.ts; src/app/api/quick-replies/route.ts |
| deals | account_id | auth.users(id), pipelines(id), pipeline_stages(id), conversations(id), profiles(id), contacts(id), accounts(id), meta_ad_attributions(id, | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant | src/app/(dashboard)/pipelines/page.tsx; src/components/contacts/contact-detail-view.tsx; src/components/inbox/contact-sidebar.tsx; src/components/pipelines/deal-form.tsx; src/components/pipelines/pipeline-settings.tsx; src/components/settings/settings-overview.tsx; src/components/settings/settings-sections.ts; src/lib/automations/engine.ts; src/lib/dashboard/queries.ts; src/lib/meta-conversions/event-diagnostics.ts |
| deal_loss_events | account_id | accounts(id) | Ativo; operações por role | tenant imutável + FK composite onde há pai tenant |  |

## Rotas privilegiadas e authorization

Revisadas as famílias cookie-session, API-key, webhook, cron e engines.
Cookie ctx deriva sessão/profile/membership; API-key ctx deriva hash de chave ativa
e scopes; webhook ctx deriva config única pelo receiver; cron autentica secret
e resolve config pelo account_id de cada item, nunca por usuário informado no body.

Correções: /api/account POST; automations root/[id]/duplicate e steps; flows [id]
e activate; WhatsApp config POST/DELETE (admin antes de efeitos externos), templates
PATCH/DELETE/submit, webhook inbound/status/templates, media proxy; /api/storage;
send core e engines. Queries v1 validam contato/tags serializados contra account.
AI auto-reply e referências a prompts de flows têm filtros explícitos de account.
Config Meta, API keys, quick replies, deals/stage, contacts/tags, broadcast,
knowledge, invitations/member/ownership e webhooks v1 mantêm ctx/RPC/RLS guardados.
Cron de automations/flows/enrichment não foi executado; sender tests usam mocks.

Outbound verifica account/conversation/contact/config antes do primeiro envio.
Media privada exige prefixo da mesma account ANTES de service_role signing.
Template headers são assinados somente na cópia de entrega; references armazenadas
permanecem duráveis. Worker CAPI valida também account de config/attribution/contact,
além dos WHEREs e FK, antes de decrypt/claim/transport.

## Storage

avatars, chat-media e flow-media passam a PRIVATE. Não há outros buckets no inventário.
chat/flow paths preservados: account-<uuid>/<arquivo ou subpasta>.
Avatar existente preserva <user_uuid>/<arquivo>; membership do profile é metadata
equivalente inequívoca que resolve sua account sem mover bytes.
GET /api/storage/bucket/path usa JWT/cookie do caller e Storage RLS, nunca admin.
POST nessa rota emite signed URL de 60s; sender emite 300s após ownership.
São bearer URLs com tokens de TTL limitado, não URLs públicas persistidas.
Expiração do token não garante revogação imediata de conteúdo já servido por CDN
ou browser; não é possível recolher cópias previamente baixadas. A autorização
é exigida antes de cada emissão. Ver limitações de cache na documentação
[Supabase Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn).
GET é private/no-store, nosniff e sandbox; tipos ativos são attachment.
Media Meta legada só é buscada se mensagem ligada à account do caller possuir o ID.
Não houve transferência/movimentação de objeto nem exposição de nova URL pública.

Avatar antes: 1 objeto, 392255 bytes,
SHA-256 f90cd9e4738db46573ba438abf4bedc460cea086aea08cf8ad473327aff9b267.
Antes da correção, endpoint público retornava 200 (falha reproduzida).
Após tornar o bucket privado, a URL antiga ainda retornou 200 por cache CDN HIT,
enquanto a origem sem cache já negava acesso. Foi executada UMA invalidação do
cache CDN exclusivamente desse avatar (DELETE /storage/v1/cdn/avatars/<path>,
HTTP 200), sem DELETE /object e sem alteração de bytes, path ou metadata.
Ver [purge CDN cache](https://supabase.com/docs/guides/storage/cdn/purge-cdn-cache).
Aceite posterior: download autenticado 200; URL pública original 400; 392255 bytes
e SHA-256 idênticos ao baseline. A referência do profile usa /api/storage/avatars/.
O script 21g_purge_legacy_avatar_cache.mjs registra a operação já executada;
não o repetir como rotina nem confundir invalidação de cache com remoção do objeto.

## Verificação reproduzível

- Vitest: 122 arquivos / 1452 testes PASS; 45 testes unitários novos sobre baseline 1407.
- Typecheck PASS; lint 0 erros / 40 warnings legados.
- Build local e Docker remoto PASS; npm audit produção: 0 vulnerabilidades.
- Scheduler/reconciliation node tests: 18 PASS, sem HTTP real.
- PostgreSQL nativo 17: 138 observações/assertions com schema/funções reais;
  todas as falhas 21F reproduzidas e bloqueadas; service_role real BYPASSRLS também
  não consegue vínculos mistos. Transaction ROLLBACK preserva fingerprint das 76
  tabelas históricas do restore. Catálogo baseline functions/policies/FKs sem drift.
- Concorrência PG17, duas sessões reais: convite one-winner; claims A uma vez/B
  independente; falha A não muda B; transfer vs remove one-winner/owner consistente.
  Clone local criado exclusivamente para testes e removido; restore original intacto.
- Nenhum app/scheduler ligado ao restore. Sandbox nega rede IP da instância local.
- Sem teste de carga nem login visual real. PASS é de isolamento lógico/schema,
  native roles/RLS e backend com mocks, não promessa de ausência absoluta de bugs.

```sh
WACRM_RESTORE_ROOT=/Users/luizangelo/Backups/wacrm/staging/2026-09-17_145605 \
WACRM_AUDIT_CATALOG=/tmp/wacrm-saas-audit-catalog.json \
node supabase/tests/21g_native_regression.mjs

WACRM_RESTORE_ROOT=/Users/luizangelo/Backups/wacrm/staging/2026-09-17_145605 \
node supabase/tests/21g_concurrency_regression.mjs
```

Artifacts privados: saas-regression-21g.json e saas-concurrency-21g.json no diretório
de backup acima, permissões 0600, sem dados pessoais reais no relatório.

## Migration / rollout / rollback

Migration oficial CLI: 20260918004200_saas_tenant_boundaries_and_bootstrap.sql.
Não editar/reaplicar migrations históricas. Aplicar só depois de todos checks
verdes e imagem construída. A mesma SQL completa deve constar no ledger remoto;
timestamp gerado por apply_migration pode diferir, equivalência exige SQL exata.
Fila deve permanecer pending=0/sending=0 antes/depois, sem cron manual.
Migration transacional: violações legadas abortam; não reparar dados silenciosamente.
Schema antes da troca + deploy imediato da imagem com proxy privado; nenhuma mudança
de domínio/secret/WhatsApp externa. Scheduler permanece uma réplica/120s/stop-first.

Rollback de app para versão antiga não deve reabrir buckets públicos. Se necessário,
manter buckets PRIVATE e aplicar forward-fix compatível ou suspender acesso a media.
Não desfazer constraints/RLS para recuperar a UI; não excluir objetos/dados/eventos.
Imagens anteriores/checkouts dirty são preservados; não executar prune global.

## Baseline staging antes

Accounts 1 / profiles 1 / owners inconsistentes 0.
Meta events 8; attributions 2; pending 0; sending 0.
App/scheduler 1/1: wacrm-staging:d638ff5; ciclos recentes HTTP 200, processed 0.
Fingerprints integrais (dados cifrados só entram no hash, não são impressos):
events 05a3af23c76deab0e7c220e698e5fa4d;
attributions 8bc3d6dfac5eee2a0a4ad2efe3efcd72;
Meta config 5a3fd08dcd8fc91ab255b915eb021bcf;
WhatsApp config b43f43efef55d4eb71e57d06cd9758ed.

## Aceite staging e relatório final

Migration aplicada somente em awganmhowivedfocwzjy. O ledger oficial recebeu
20260918042320 / saas_tenant_boundaries_and_bootstrap. Timestamp gerado difere do
filename CLI, mas SQL integral é exatamente igual: MD5 b876e1b89e615c0b5860bff850482270;
SHA-256 10a4f0bd628a3a4aa3901bb9e9e6f8a142a84aabaa710b6bc365a10f4500f158.
Não houve repair manual do ledger nem reaplicação de migrations antigas.

Catálogo posterior: 40/40 tabelas públicas com RLS; 9 children com account_id;
43 FKs composites tenant-scoped (36 novas/substituídas + 7 anteriores).
authenticated não possui INSERT em profiles; três buckets PRIVATE.

Deploy do código ed9ebd7f62f4b0cd74b09b02ed3ec0f4ef02ff2b, imagem
wacrm-staging:ed9ebd7; image ID
sha256:77245e16749c6671db1daada46894a0122f90f4bdbeb9355605a223e8a9863f0.
App e scheduler 1/1, healthy, restart count 0, mesma imagem verificada no container.
Scheduler manteve 120000ms; ciclos automáticos 04:23:54.707Z e 04:25:54.707Z:
HTTP 200, processed/sent/failed/delivery_unknown/errors=0. Nenhum cron manual.
Smoke anônimo: login 200; account/config/eventos/Storage/conversations exigem auth
e retornam 401. Nenhum browser ou integração Meta externa foi usado.

Meta events 8 → 8; attributions 2 → 2; pending 0 → 0; sending 0 → 0.
Fingerprints integrais de events, attributions, Meta config e WhatsApp config
permaneceram idênticos aos quatro valores do baseline, com a mesma serialização
md5(jsonb_agg(to_jsonb(row) ORDER BY id)::text). Nenhum evento novo ou token alterado.
Reaudit nativa repetida após deploy: 138 PASS, restore histórico intacto.

Advisors: nenhum novo RLS-disabled/search_path warning. As funções SECURITY DEFINER
executáveis são exceções revisadas: membership/peek por anon; sete RPCs anteriores
e duas novas por authenticated (create_my_account/can_access_tenant_object).
As novas não concedem EXECUTE a PUBLIC/anon; helpers privados não são expostos.
automation_pending_executions sem policy browser é deny-by-default intencional.
vector em public e leaked password protection desabilitada são avisos legados;
nenhuma mudança de configuração Auth/extensão foi feita. A decisão sobre proteção
de senhas permanece item da preparação de produção, não falha tenant nova.

As orientações Supabase influenciaram constraints/RLS em camadas, grants mínimos,
Storage privado e testes nativos com roles reais, além dos mocks do backend.
Não há autorização para produção, DNS, freeze ou cutover mesmo após GO.

### Relatório final solicitado (47 itens)

1. Cross-account associations: FIXED.
2. Estratégia: combinação de composite FKs/unique, triggers de tenant imutável e membership, grants e RPCs transacionais.
3. Tabelas: todas as 40 da matriz acima. Relações composite reforçadas em conversations, contact_notes, contact_tags, contact_custom_values, messages, pipeline_stages, deals, broadcast_recipients, automation_steps, automation_logs, automation_pending_executions, message_reactions, flow_nodes, flow_runs, flow_run_events, notifications, ai_knowledge_chunks, ai_usage_log e meta_conversion_events; proteções Meta anteriores preservadas.
4. RLS audit: PASS.
5. RLS/grants corrigidos: notifications, profiles e storage.objects; políticas tenant corretas anteriores preservadas nas demais tabelas.
6. Backend authorization: PASS nos fluxos auditados e testes controlados.
7. Endpoints corrigidos: POST /api/account; /api/automations, /api/automations/[id], /api/automations/[id]/duplicate; /api/flows/[id], /api/flows/[id]/activate; POST/DELETE /api/whatsapp/config; PATCH/DELETE /api/whatsapp/templates/[id] e submit; /api/whatsapp/webhook; /api/whatsapp/media/[mediaId]; /api/storage/[bucket]/[...path]; guards compartilhados de send/engines/CAPI e serialização v1. Inventário completo de callers na matriz.
8. Notification leak: FIXED, inclusive saída de membership e Realtime filtrado.
9. Account takeover sem profile: FIXED; INSERT direto/forged account/role negados.
10. Account creation: PASS, operação oficial idempotente e atômica.
11. Onboarding: PASS; defaults utilizáveis, mappings NULL, nenhuma credencial herdada.
12. Invitation flow: PASS, conta/role/validade/uso único e concorrência.
13. Membership roles: PASS; hardening 21B preservado, owner consistente na concorrência.
14. WhatsApp config isolation: PASS.
15. phone_number_id uniqueness/resolution: PASS; UNIQUE(account_id) e UNIQUE(phone_number_id); WABA não unique.
16. Inbound routing: PASS, receiver conhecido obrigatório, sem tenant default.
17. Status routing: PASS, phone_number_id → account → mensagem filtrada.
18. Cross-tenant status test: PASS; mesmo external ID em A/B altera somente A.
19. Outbound resource binding: PASS, fail-closed antes de transporte externo.
20. Meta tenant isolation: PASS, config/attribution/contact/event/dataset por account.
21. Scheduler multi-account: PASS, claims independentes/atômicos; falha A não altera B.
22. Storage buckets: avatars PRIVATE; chat-media PRIVATE; flow-media PRIVATE.
23. Storage paths tenant-aware: SIM, account-UUID para chat/flow; avatar user UUID → profile.account_id.
24. Storage RLS: PASS, três buckets cobertos em A/B.
25. Signed URL authorization: PASS, caller JWT/membership antes da emissão; conhecimento do path não autoriza.
26. Existing avatar preserved: SIM, mesmo checksum/tamanho; acesso público antigo negado.
27. Tests novos: 45 unitários; mais 138 observações/assertions nativas e 3 cenários concorrentes, contabilizados separadamente.
28. Tests total: 1452 Vitest PASS (122 arquivos), 18 Node PASS, 138 nativos PASS e 3 cenários concorrentes PASS. Os 317 anteriores continuam cobertos/passing.
29. Typecheck: PASS.
30. Lint: 0 erros / 40 warnings legados.
31. Build: PASS local e Docker staging.
32. Migration nova: 20260918004200_saas_tenant_boundaries_and_bootstrap.sql.
33. Staging migrations: PASS; ledger 20260918042320, SQL integral equivalente.
34. Staging deploy: ed9ebd7 / wacrm-staging:ed9ebd7; image ID acima.
35. App: 1/1, healthy, 0 restarts.
36. Scheduler: 1/1, healthy, 0 restarts, 120s.
37. Meta events antes/depois: 8 / 8, fingerprint idêntico.
38. WhatsApp real enviado: NÃO.
39. POST /events: NÃO.
40. Tenant A/B reaudit: PASS, banco nativo/RLS/service_role + backend e concorrência, sem dados sintéticos no staging.
41. Arquitetura multi-tenant: PASS no escopo controlado auditado; um app/múltiplas accounts, um número por account, sem fallback global.
42. SaaS ready: SIM para os critérios lógicos desta etapa; não equivale a produção criada/aprovada, teste de carga ou garantia absoluta de segurança.
43. Produção criada: NÃO.
44. DNS alterado: NÃO.
45. GO/NO-GO para retomar PREPARAÇÃO de produção: GO, não autorização de deploy/cutover.
46. Bloqueios multi-tenant reproduzidos restantes: NENHUM. Pendências pré-produção: decisão manual sobre avisos Auth legados, revisão do backup/captura final, aprovações e provisionamento separados da topologia B. Sem freeze agora.
47. Próxima ação exata: revisar/aceitar este relatório e autorizar uma etapa separada de preparação do Supabase/stack de produção da topologia B; não executar freeze, DNS ou cutover nesta etapa.
