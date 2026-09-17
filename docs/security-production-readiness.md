# Hardening e prontidão — ETAPA 21B

Escopo: repositório WACRM e staging `awganmhowivedfocwzjy`/`wacrm_staging`.
HEAD inicial `b62dca8392116bf7577a15117f11fa836e8335ee`. Produção não criada nem
promovida. Nenhuma operação Meta, cron manual, envio WhatsApp, movimento de deal
real ou POST CAPI faz parte da validação.

## RPCs auditadas e correção

As cinco funções abaixo eram SECURITY DEFINER, owner postgres, `search_path=public`,
EXECUTE efetivo anon/authenticated/service_role (inclusive por grant PUBLIC),
sem `auth.uid()`/membership. IDs de recurso não eram autorização. As merges
percorrem grupos account_id, mas isso não autoriza um usuário a fazer manutenção
em TODOS os tenants.

| Função | Origem | Chamador legítimo / account |
| --- | --- | --- |
| merge_duplicate_contacts() | 022_contact_phone_dedup.sql | Manutenção DB, nenhum frontend/RPC de usuário; grupos account_id + phone_normalized |
| merge_duplicate_conversations() | 036_conversation_contact_dedup.sql | Manutenção DB, nenhum frontend/RPC de usuário; grupos account_id + contact_id |
| claim_ai_reply_slot(uuid,integer) | 029_ai_reply.sql; grant 031 | AI auto-reply (`supabaseAdmin`); conversation resolvida pelo webhook/account |
| record_webhook_failure(uuid,integer) | 028_webhook_endpoints.sql | dispatchWebhookEvent chamado somente no webhook com admin client; endpoints filtrados por account_id |
| recompute_broadcast_counts(uuid) | 005_broadcast_counts_incremental.sql | Reparo de aggregates administrativo; broadcast por ID, sem frontend |

Helper adicional `_bcast_bump(uuid,text,integer)` (005) tinha a mesma exposição:
invocação livre permitiria alterar broadcasts fora do tenant. Também fechado.
Essas SEIS funções agora são SECURITY INVOKER, somente service_role/owner executam.
Backend service_role já tem privilégios de tabelas e BYPASSRLS; invoker remove
elevação desnecessária e mantém manutenção global por operador autorizado.
Não executamos merges/recomputes em dados staging para testar acesso.

UMA nova migration CLI:
`20260917161334_security_hardening_privileged_rpcs.sql`.
Allowlist explícita das 20 funções definers legadas, sem alteração de migrations
históricas. Fixa `pg_catalog, public, pg_temp`, com pg_temp explicitamente último;
asserta que browser roles não podem CREATE em public. Remove PUBLIC/browser grants
e devolve só os acessos revisados. Owner continua postgres. `anon`/`authenticated`
não recebem execução dos helpers internos ou das funções de trigger.

Trigger-only `broadcast_recipient_aggregate_trigger`, `handle_new_user`,
`notify_conversation_assigned` permanecem definers porque precisam escrever apesar
de RLS, mas sem chamada pública direta. Grants dos triggers existentes não são
revogados por essa alteração do EXECUTE público. Warnings DB de signup/assignment
passam a imprimir SQLSTATE, não SQLERRM, mantendo o comportamento de fallback.
Os quatro RPCs que já eram service-only também receberam search_path seguro:
increment_flow_execution_count, increment_automation_execution_count,
bump_conversation_on_inbound, create_broadcast_with_recipients.
Também fixado search_path dos quatro helpers invoker apontados pelo advisor:
_bcast_cols_for_status, update_updated_at_column, update_ai_configs_updated_at,
update_ai_knowledge_documents_updated_at; sem modificar seus corpos/grants.

## Definers públicos que permanecem: justificativas

| Função | anon | authenticated | Por que segura / necessária |
| --- | --- | --- | --- |
| is_account_member(uuid,account_role_enum) | Sim | Sim | Booleano RLS: profiles.user_id=auth.uid(), account/role; UID ausente → false; evita recursão RLS |
| peek_invitation(text) | Sim | Sim | Preview read-only por capability hash de token 256-bit, unexpired e unused, antes do login; não lista convites, tokens, pessoas ou emails |
| set_member_role(uuid,account_role_enum) | Não | Sim | UID/profile ativo + admin/owner; target mesma account, não próprio/owner; não promove owner |
| remove_account_member(uuid) | Não | Sim | UID/profile + admin/owner; target mesma account, não self/owner; conta pessoal nova é efeito administrativo intencional |
| transfer_account_ownership(uuid) | Não | Sim | UID/profile owner; target mesma account; não self; atualiza propriedade atomicamente |
| redeem_invitation(text) | Não | Sim | UID/profile + capability validada/locked; somente proprietário único de conta vazia; move só o próprio profile |
| touch_presence(text) | Não | Sim | UID/profile, status fechado; account resolvida do caller, escreve somente seu user_id |

Membership ativa neste schema é o profile corrente com account_id/account_role;
não existe flag independente de membership inativa. Convite é exceção intencional
ao acesso na mesma conta: posse do token autoriza ingressar em outra conta.
Foi corrigida uma checagem ausente: redeem_invitation dizia exigir sole owner,
mas não recusava conta vazia com teammates; a nova migration verifica outros
profiles antes de qualquer escrita. Nenhum convite real foi resgatado.
RPCs de escrita também bloqueiam as linhas usadas na autorização e qualificam
updates de target pelo account_id já autorizado, evitando troca concorrente de
membership entre checagem e escrita. Redemption serializa a conta alvo e a antiga.

## Logs e PII

Antes: sender imprimia full phone original/variante e autocorreção. Erros brutos
Meta/DB/rede, `.message`/stack, template webhook value/nome e error.code truncado
em 64 chars podiam conter telefone/email/nome/credentials/clid/hash completo.
São caminhos de risco comprovados no código, não afirmação de incidente ocorrido.

Depois: `src/lib/security/operational-log.ts` produz somente error_kind fechado,
SQLSTATE/PGRST/numeric Meta codes, ou recipient_digit_count/recipient_last4.
Não encaminha message/details/stack/payload. Status errors mantêm códigos e textos
do vocabulário diagnóstico conhecido; texto arbitrário vira `[REDACTED]` somente
nos logs (persistência prévia não alterada). IDs de mensagem são mascarados.
Console da interface também usa o helper para não repetir erro HTTP bruto.
Captura, envio, fallback BR, mensagens para o usuário e snapshots continuam iguais.
CAPI nunca loga user_data, payload, hashes ou ctwa_clid completo; scheduler só
imprime contadores allowlisted. JSON.stringify(payload) encontrado nos transports
é BODY de HTTP, não log, e foi preservado.

Regressões: fictitious sender normal/fallback/Meta error/network error com fetch
mockado, spies de todos os métodos console, verificação de phones/email/name/
secret/clid/hash ausentes; unit tests helper e AST de chamadas console do projeto.
Logs pós-deploy são verificações passivas: não geramos tráfego real só para logar.

## Typecheck limpo e artefatos

Três arquivos `.next/types/* 2.ts` tinham SHA-256 idêntico ao canônico, criação
simultânea 2026-09-17 02:37:29 e modo 0600 (canônicos 0644 e mais novos).
Nenhum estava no Git; scripts do projeto não geram sufixo ` 2.ts`. Cópias antigas
de cache gerado são a causa imediata da declaração duplicada. Os metadados são
compatíveis com cópia/conflito macOS, mas não provam qual aplicativo criou as cópias.

Cache inteiro movido, recuperável, para `/tmp/wacrm-21b-next-cache-oxGBWH/next-cache`.
Executado npm ci → npm run typecheck normalmente, sem excluir fontes/alterar
tsconfig. Build novo não recriou arquivos duplicados. Ignore já cobria .next/
out/build/node_modules/tsbuildinfo; adicionados macOS `._*`, `.AppleDouble`,
`* 2.ts`, `* 2.tsx` e diretório gerado CLI `/supabase/.temp/`.
Checkout/build devem ficar fora de sincronizadores de arquivos; em recorrência,
registrar processo gerador, não manter uma exclusão TS que mascare cache errado.

## Dependências de segurança

npm ci revelou 12 vulnerabilidades (incluindo Next/sharp críticas/altas).
Correção mínima de versões diretas dentro da mesma geração: Next/eslint-config-next
16.3.3, sharp 0.35.4 e Vitest 4.1.11, mais correções compatíveis de transitivas
via lockfile. Não houve upgrade major React/Supabase ou mudança de APIs/negócios.
`npm audit` ficou com zero vulnerabilities. Advisories primários:
[Next AVIF](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4),
[sharp](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c).
Lint tem warnings legados e quatro novos avisos da regra de navegação Next,
nenhum erro; deprecações middleware/Edge não são falha de build.
Docker foi atualizado de Node 20 EOL para Node 24.21.0 LTS (a mesma versão dos
testes locais); os três estágios usam a versão fixa. App e scheduler devem usar
a mesma nova imagem, sem secrets no build.
[Calendário oficial Node](https://nodejs.org/en/about/previous-releases).

## Scheduler e deploy: critérios

Mesmo script, sem literal staging: META_CONVERSIONS_APP_URL (interno),
META_CONVERSIONS_CRON_SECRET_PATH (Docker Secret sob /run/secrets), intervalo e
timeout configuráveis. Defaults loopback + arquivo genérico, 120000/70000;
URL pública, credentials/query/hash/path extra ou secret path fora da pasta
falham fechados ANTES de ler secret/fetch. Redirects continuam error; uma chamada
por janela, execução sequencial, nenhum retry automático de evento.
Staging configura hostname/secret explicitamente, uma réplica stop-first.

Deploy deve confirmar fila vazia antes da troca e comparar todas as 8 linhas
históricas Meta, configuração e atribuições antes/depois. Build em worktree
remoto separado, preservando alterações locais de auth no checkout antigo.
Manifesto, imagem real e com.docker.stack.image devem apontar à mesma tag.
Não atualizar/rotacionar secrets existentes. Após troca, validar health e HTTP
read-only/login/proteção de endpoints, sem Graph API ou envios reais.

VPS: removidos apenas 3 caches privados/reclaimable npm-ci antigos do WACRM,
confirmados por contexto/repo e timestamps dos builds; aproximadamente 3.423 GB
regeneráveis. Nenhuma imagem de rollback, volume ou outro serviço foi removido.
IDs: wk30eyh17x2sz4j41b3gg0gka, 9ls2aibomd1qjdwzh1nrshelp,
z6s57bjfa24r5umlicgl0mvqw. Espaço livre passou de 1.2 para 4.9 GB antes do build.

## Próxima etapa, não executada

Advisors adicionais: automation_pending_executions tem RLS sem policy porque é
fila interna service-only (nega browser); vector em public permanece por
compatibilidade dos tipos/AI e public não aceita CREATE dos browser roles.
Esses avisos não representam uma RPC privilegiada insegura. Proteção de senhas
vazadas do Auth está desativada: verificar disponibilidade/plano e habilitar
manualmente antes de produção, ou documentar controle equivalente. Auth não foi
alterado nesta etapa. Referências de remediação:
[fila RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
[extensão](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public),
[password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Revisar [reconciliação](migration-reconciliation.md), escolher explicitamente
A/B em [topologia e backup](production-topology-and-backup.md), autorizar backup
e ENSAIO de restore isolado. GO para planejar/executar essa etapa não autoriza
produção. Backup/restore não foi executado, e a decisão de produção permanece pendente.
