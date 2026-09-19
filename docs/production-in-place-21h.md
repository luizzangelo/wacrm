# Etapa 21H — produção oficial in-place

Decisão final do usuário, formalizada em 2026-09-18: AMBIENTE ÚNICO PRODUTIVO.
Não existe staging remoto separado do WACRM. Esta formalização não exige deploy,
migration, cópia de dados, mudança de domínio ou interrupção de integrações.

**Apesar do nome histórico wacrm_staging, esta é a infraestrutura produtiva oficial.**

## Inventário vigente

| Recurso | Identificação |
| --- | --- |
| Status operacional | PRODUCTION |
| Domínio | https://crm.luizangelo.com.br |
| Supabase | wacrm / awganmhowivedfocwzjy / us-east-1 / ACTIVE_HEALTHY |
| Organização | Shodisparo / tpweqctwwkzaajmvrqne / Free |
| VPS | 5.161.111.81 |
| Stack | wacrm_staging (nome legado) |
| App | wacrm_staging_app, 1/1, healthy, RestartCount=0 |
| Scheduler | wacrm_staging_meta_conversions_scheduler, 1/1, healthy, RestartCount=0 |
| Imagem de ambos | wacrm-staging:ed9ebd7, sem latest |
| Image ID local | sha256:77245e16749c6671db1daada46894a0122f90f4bdbeb9355605a223e8a9863f0 |
| Cron automático | 120000 ms, uma réplica, execução sequencial |

O Image ID identifica os bytes locais verificados, não um RepoDigest de registry.
Não renomear stack, serviços, Docker Secrets, imagem ou service libpq por estética.
Não criar wacrm-production, segundo Auth/DB/scheduler ou sincronização de ambientes.
Não executar os planos históricos de freeze/captura para migração/cutover.
O projeto Shodisparo **zyqbgrrpedzxfcwhlfoa** é outro sistema: permanece intocado.

A account existente é o primeiro tenant, sem privilégio especial/default/global.
Cada account pode configurar seu próprio número, WABA, tokens e Dataset. O modelo
atual é um número por account, não vários números dentro da mesma account.

## Readiness: NO-GO, sem suspender a operação existente

A designação produtiva é oficial pela decisão do usuário; não equivale a um
aceite de segurança irrestrito. **NO-GO** nesta coleta por:

1. Auditoria administrativa Auth incompleta: Site URL do Auth, redirects, SMTP,
   política de senha, rate limits e configuração MFA não estão expostos pelo
   conector disponível ou por /auth/v1/settings. Não assumir defaults como prova.
2. Cadastro público está permitido e confirmação de e-mail está desativada.
   Requer decisão explícita e validação do canal de e-mail antes de abertura SaaS.

Finding Storage inicial foi corrigido operacionalmente: HTTP 200/HIT servia
exatamente os bytes do avatar, enquanto GET com nonce retornava 400 na origem.
Uma única purga CDN pontual via /cdn (não /object) retornou HTTP 200. Após mais
de 60s, URL exata retornou HTTP 400/BYPASS e nonce HTTP 400; checker exit 0.
Avatar continua 392255 bytes e com SHA-256 original. Nenhum objeto apagado,
movido ou alterado. Nenhum upgrade executado. A [documentação de purga](https://supabase.com/docs/guides/storage/cdn/purge-cdn-cache)
declara Pro ou superior, apesar do aceite observado nesta conexão Free; não
assumir disponibilidade garantida futura nem repetir purga como rotina.
PASS é da origem/código e edge consultado; não é teste de todos os edges globais.

Próxima ação: obter evidência read-only das configurações Auth no projeto correto.
Quaisquer alterações Auth/SMTP/plano exigem etapa separada, sem tokens em chat.

## Fotografia antes/depois e escopo de preservação

Inicial: 2026-09-18T14:58:28Z. Revalidação final de eventos: 2026-09-18T15:13:52Z.

- App/scheduler saudáveis, somente os dois serviços WACRM na única stack.
- Dois containers WACRM executando; containers de tasks antigas estão parados,
  não são consumidores/schedulers órfãos ativos. Não houve prune.
- Eventos Meta: 8 → 8; pending=0, sending=0; 6 sent, 1 failed,
  1 skipped_no_attribution. Fingerprint completo invariável:
  `05a3af23c76deab0e7c220e698e5fa4d`.
- Atribuições CTWA: 2; auth.users=1, auth.identities=1, auth.mfa_factors=0.
- Scheduler observado automaticamente às 14:50, 14:52, 14:54, 14:56, 14:58,
  15:00, 15:02, 15:04, 15:06, 15:10, 15:12 e 15:14 UTC: HTTP 200,
  contadores de processamento zerados.
- Nenhum cron manual, POST /events, WhatsApp enviado, movimento de negócio,
  mudança de DNS/Auth ou integração CRM Meta/WhatsApp/SMTP provocada por esta etapa.
- Nenhuma alteração no banco ativo, migrations, objetos ou metadata Storage.
- Única mutation externa de hardening: invalidação CDN de um avatar legado,
  sem alteração dos objetos/buckets/banco. Nenhuma operação Meta/WhatsApp/SMTP.

O scheduler produtivo continua ativo: eventual ação legítima do usuário pode
gerar processamento automático posteriormente. O resultado acima é da janela
consultada, não promessa de imutabilidade futura com o sistema operando.

## Backup externo novo — PASS

Destino privado, fora do Git, VPS e Supabase:
`/Users/luizangelo/Backups/wacrm/production/20260918T150049Z`.

- Início: 2026-09-18T15:00:50.338Z; fim: 2026-09-18T15:02:03.230Z.
- pg_dump custom completo, PostgreSQL cliente 17.5 / servidor 17.6.
- `database.dump`: **909870 bytes**.
- SHA-256: `6dcddaaa7fe837c09d5692e5118c320a162f2e7d88d6a750ff681c85bbe192dd`.
- pg_restore --list e extração offline de schema: PASS.
- Archive contém dados Auth, public, migration history (48 entradas), Storage
  metadata e schema wacrm_private 21G.
- Auth validado exclusivamente por contagem: users=1, identities=1.
- Storage bytes copiados separadamente: 1 objeto, 392255 bytes; SHA-256 validado
  em memória, arquivo salvo e verificação independente do manifesto.
- SHA do avatar preservado:
  `f90cd9e4738db46573ba438abf4bedc460cea086aea08cf8ad473327aff9b267`.
- Manifesto agregado: 10 arquivos verificados independentemente, todos PASS.
- Storage inventariado antes/depois: objetos e configuração dos buckets iguais.

Artefatos: dump/SHA, TOC, schema offline, inventários antes/depois, inventário
Storage, checksums individuais/agregados e backup-result.json. Paths privados
dos objetos aparecem somente nos artefatos restritos, nunca neste relatório.
Diretório 0700, arquivos 0600, FileVault On; Mac com aproximadamente 51 GiB livres.

Script explícito, **não agendado**: `deploy/backup-production.mjs`. Só executar
com autorização para um novo backup; cada execução cria um timestamp novo.
libpq usa service legado wacrm_staging, validado para o projeto aprovado, TLS
sslmode=require; .pgpass não é lido pelo script nem reproduzido. Source sessions
usam default_transaction_read_only=on. Falhas param, preservando artefatos parciais,
sem retry, overwrite ou exclusão automática.

**Limite de segurança:** nenhum Docker Secret, senha libpq, URI com senha,
ENCRYPTION_KEY ou chave operacional de serviço foi exportado. Um dump completo
de Auth/banco NÃO é um arquivo livre de material sensível: inclui hashes de senha,
estado persistido Auth e credenciais de tenants armazenadas no banco, inclusive
ciphertexts. Isso é necessário para DR; proibir publicação e tratar como segredo.
O campo histórico secret_material_exported=false de backup-result.json significa
ausência de exportação de secrets operacionais; não significa banco sem conteúdo
sensível. O script agora explicita operational_secrets_exported=false.
FileVault protege o volume local, não fornece criptografia portátil do dump.
Não copiar para outro destino antes de definir criptografia e controle de acesso.
As chaves operacionais indispensáveis ao recovery precisam de escrow separado e
seguro; NÃO colocar ENCRYPTION_KEY junto ao dump ou regenerá-la para ciphertexts.

Consistência: pg_dump possui snapshot transacional; Storage foi capturado
separadamente com inventário estável. Não houve freeze nem snapshot coordenado
DB/Storage. Novas capturas precisam detectar deltas; não afirmar atomicidade
cross-service. Não executar o app/scheduler contra um banco restaurado.

### Recuperabilidade e histórico

Drill anterior [21D](backup-restore-drill-21d.md): PASS, 76 tabelas comparadas,
roles/constraints/FKs/functions/RPCs/Auth/migrations/Storage validados isoladamente.
Diretório original `/Users/luizangelo/Backups/wacrm/staging/2026-09-17_145605`
preservado; checksum do dump histórico revalidado nesta etapa.

Novo dump utiliza o mesmo formato/método. Hardening 21G real foi testado sobre o
laboratório PG17 isolado, incluindo schema/funções/roles e concorrência. Nenhuma
mudança estrutural nova nesta etapa. Por autorização do usuário, não repetir o
restore completo imediatamente. **O novo dump não foi efetivamente restaurado**;
list/checksum não substituem restore. Repetir drill trimestralmente e antes de
alteração material de formato, extensão, role ou schema; RTO completo não medido.

## Backup diário e retenção — PLANO PRONTO, NÃO IMPLEMENTADO

Baseline: execução diária 03:00 America/Fortaleza, com RPO alvo até 24h após
captura bem-sucedida. Destino externo sempre ligado e credenciais restritas ainda
precisam de escolha/aprovação. Mac atual desligado/suspenso não garante esse RPO.
Segunda cópia externa criptografada é recomendada para falha/perda do Mac.

- 7 diários, 4 semanais, 3 mensais; um artefato pode satisfazer mais de uma classe.
- Preservar permanentemente o DR histórico e este baseline até decisão explícita.
- Snapshot SQL + Storage bytes + metadata + checksum + teste TOC em cada ciclo.
- Sem concorrência de capturas; lock; destino novo; limites de download revistos
  ao crescer (script atual limita objeto a 32 MiB e saída a 64 MiB).
- Erro, checksum inválido, drift Storage ou falta de espaço: alertar e parar;
  nunca apagar automaticamente o último backup válido nem tentar restore.
- Alertar último sucesso >26h e espaço livre <20% ou insuficiente para duas
  capturas completas; não considerar scheduler Meta como scheduler de backup.
- Retenção futura somente após manifesto válido + segunda cópia confirmada,
  com aprovação explícita da política de descarte. Não aplicada agora.

DB+Storage desta captura somam 1302125 bytes (~1,24 MiB), sem contar manifests e
schema. Quatorze cópias equivalentes seriam ~17,4 MiB só desses bytes; isso não
é previsão de crescimento/volume total nem inclui o laboratório histórico.
Reservar margem e dimensionar pela captura completa real. Não agendar o script
atual sem revisar destino, SSH/service role, TLS, lock, criptografia e alertas.

## Capacidade VPS — PASS para carga atual observada, sem prova de pico

Coleta final de capacidade: 2026-09-18T15:08:59Z.

- RAM total 4004438016 bytes (3,73 GiB); usada 3032899584 (2,82 GiB);
  disponível 971538432 (926,5 MiB / 0,90 GiB).
- Swap total 2147479552 (2,00 GiB); usada 870084608 (0,81 GiB).
- 3 vCPUs; load 0,00 / 0,03 / 0,01; PSI memória avg10/60/300=0,00.
- Disco total 39990112256 bytes; usado 27408154624; livre 10906112000
  (10,16 GiB), 72% usado.
- 16 serviços ativos; WACRM app ~82,8 MiB/limite 768 MiB, scheduler ~33,4 MiB/
  limite 128 MiB. Amostra inicial dos demais: n8n editor ~398,7, worker ~388,4,
  webhook ~202,9 MiB; Postgres ~249,9; Evolution v2 ~131,5; Redis ~97,5;
  Nextcloud ~91,8; Traefik ~91,4; demais ~3–25 MiB.

Não há consumidor WACRM duplicado nem evidência de thrashing nesta janela.
Memória tem pouca folga para picos dos outros serviços. Não executar build pesado
na VPS compartilhada sem orçamento; preferir build externo. PASS não é ensaio de
carga/SLA: crescimento precisa de capacity planning. Nenhum resize/prune/removal.

## Segurança, isolamento e Auth

Migration obrigatória local: 20260918004200_saas_tenant_boundaries_and_bootstrap.sql.
Ledger remoto: 20260918042320 / saas_tenant_boundaries_and_bootstrap; SQL integral
equivalente, MD5 b876e1b89e615c0b5860bff850482270. Timestamp diferente é documentado,
não motivo para reaplicar migration. 40 tabelas public / 40 RLS; 43 composite FKs.

Revalidação 21G: RLS, cross-account FKs, autorização backend, convite, bootstrap,
tenant A/B, WhatsApp e Meta por account: PASS. Native PG17 inclui BYPASSRLS real;
backend/transports têm testes com mocks, não novos envios reais. Novo tenant
recebe owner/profile, pipeline normal + Venda perdida, WhatsApp desconectado e
Meta ausente, sem herdar recursos do primeiro tenant. Inbound/status usam
phone_number_id → whatsapp_config → account, nunca fallback/default.
Atomic claim e terminal delivery_unknown/failed/sent permanecem zero-retry.

Buckets avatars/chat-media/flow-media PRIVATE; paths tenant-aware e assinatura
autorizada antes de service_role: PASS de origem/código/RLS. **Storage runtime
final PASS** após a purga pontual e HTTP 400 das URLs anônimas. TTL de assinatura
não garante revogação de bytes já cacheados/baixados. Verificação agora falha
explicitamente em exposição de cache ou origem.

Auth real consultado por GET /auth/v1/settings e contagens, sem alterações:

| Configuração | Evidência / classificação |
| --- | --- |
| App Site URL | https://crm.luizangelo.com.br; OK, NODE_ENV=production |
| Auth Site URL e Redirect URLs | DESCONHECIDOS nesta conexão; BLOCKER de auditoria/coerência |
| Confirmação de e-mail | mailer_autoconfirm=true, desativada; BLOCKER antes de abertura SaaS |
| Cadastro público | disable_signup=false; habilitado, decisão de confirmação necessária |
| Providers ativos | email; OK conforme modelo atual |
| SMTP | DESCONHECIDO; BLOCKER de validação de onboarding/recovery em produção |
| Password policy e rate limits | DESCONHECIDOS; BLOCKER de auditoria, não falha afirmada |
| MFA | 0 fatores persistidos; configuração administrativa desconhecida; RECOMENDADO |
| Leaked-password protection | desativada; RECOMENDADO, indisponível no Free; sem upgrade |

Não inferir Auth Site URL pelo NEXT_PUBLIC_SITE_URL. Não enviar recovery/signup
para testar nesta etapa. O fluxo de código/nativo passou; entrega real de e-mail
e os parâmetros administrativos não foram aceitos. Sem PAT de management disponível.

Quatro secrets operacionais presentes/nonempty em Docker Secrets; nenhum dos
quatro valores no ENV plaintext dos service/container inspect. Shell startup só lê os arquivos
para a memória do processo. .env.local ignorado pelo Git; somente template versionado.
Nenhuma credencial foi colocada em novos scripts/docs ou artefatos operacionais.

Logs app consultados: 24h, 1195 bytes/11 linhas; zero matches dos valores atuais
de PII, secrets e ctwa_clid, zero padrões Bearer/password URI/raw message body.
PASS limitado à janela e scanner; não constitui prova sobre todo histórico/CDN.
Scheduler logs possuem allowlist de contadores, sem payload/secret.

Advisors: filas internas sem policy permanecem deny-by-default
([0008](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy));
vector em public preservado por compatibilidade, sem CREATE público
([0014](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public));
RPCs SECURITY DEFINER legítimas anon/authenticated permanecem guardadas e testadas
([0028](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
[0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)).
Não há finding novo de RLS disabled ou search_path mutável. Leaked-password
finding permanece documentado, não corrigido por mudança de plano silenciosa.

## Inventário sem limpeza

Fonte atual: 1 account, 1 profile, 3 contacts, 3 conversations, 22 messages,
1 pipeline, 2 deals, 2 CTWA attributions e 8 conversion events.

- REAL: recursos operacionais de tenant, Auth, conexão WhatsApp/Meta e avatar;
  não imprimir valores de contato/IDs privados.
- TESTE histórico: etapas anteriores identificam as duas atribuições reais CTWA
  e os eventos de integração como testes deliberados com recursos reais. Isso é
  proveniência histórica, não um flag inequívoco de descartabilidade no schema.
- INDETERMINADO para descarte: os 3 contacts/3 conversations/22 messages/2 deals/
  pipeline e suas dependências. Não presumir que todo o tenant é sintético.
- Zero pipeline com nome contendo test; zero deal no nome histórico TESTE META
  CAPI; zero mensagem com conteúdo EXATAMENTE igual ao marker TESTE AUTO CAPI 19E.
  Nomes/conteúdo atuais não devem ser inferidos de requests anteriores.
- Zero contatos fixtures nativos 21G na fonte. A/B/C foram testados só no laboratório.
- Nenhum registro/objeto produtivo removido ou alterado; futura decisão exige
  inventário específico de dependências e aprovação explícita.

## Supabase Free: limitações aceitas como risco, não alta disponibilidade

Free: pausa após 1 semana de inatividade; sem automatic backups/PITR/SLA;
500 MB DB, 1 GB Storage, 50 mil MAU; egress 5 GB e cached egress 5 GB;
API/DB logs 1 dia, Auth audit logs 1 hora. Leaked-password protection indisponível;
SMTP custom e MFA básico são suportados, mas configuração atual não foi comprovada.
Fonte consultada em 2026-09-18: [planos oficiais](https://supabase.com/pricing).
Não inventar tráfego para evitar pausa. A cadência do cron não é garantia contratual
de não-pausa. A account real e integrações atuais não dão ao Free SLA produtivo.
Ausência de backup automático torna a captura externa diária especialmente crítica;
[backup DB não inclui bytes Storage](https://supabase.com/docs/guides/platform/backups).
Nenhum upgrade ou cobrança autorizado/executado. Não tocar o outro projeto.

## Operação diária e incidentes

Checklist sem disparos manuais:

- App e scheduler 1/1 healthy; restarts/OOM/tasks failed; uma réplica e nenhum
  segundo stack/consumer WACRM ativo. Tasks exited históricas não são duplicatas ativas.
- Disponibilidade DB/Auth, erros 5xx/webhook/HMAC e delivery errors WhatsApp;
  ler logs sanitizados, nunca colar payloads/tokens/PII no ticket.
- Pending idade/backlog, sending stale e delivery_unknown; revisar findings na
  observabilidade CRM, sem resetar eventos terminais ou rodar cron manual.
- Duas execuções automáticas consecutivas HTTP 200 como health de scheduler;
  não confundir HTTP 200 de cron com aceitação/entrega Meta por evento.
- RAM disponível (<512 MiB sustentado: investigar), PSI/swap-in/out/OOM; disco
  livre <20% ou <5 GiB: alertar, sem prune global ou apagar backups.
- Último backup válido/checksum/TOC/Storage e destino externo; alerta >26h quando
  o plano diário estiver implantado. Agora existe snapshot manual, não cobertura diária.
- Status Free/quotas/pausa e configuração Auth; falha não autoriza upgrade ou
  operações sobre Shodisparo.

Não instalar observability stack nesta etapa. Persistir futuro histórico operacional
sanitizado fora da janela curta do Free exige aprovação de destino/retenção.

## Deploy futuro sem staging remoto

1. Feature branch e diff revisado; nunca testes sintéticos diretamente na produção.
2. npm test, npm run typecheck, npm run lint, npm run build; testes Node de
   scheduler/equivalência e PG17 A/B/concurrency isolados sem integração externa.
3. Migrations append-only, revisão de grants/RLS/FKs/function search_path e teste
   em banco local. Nunca editar migration histórica/reaplicar SQL equivalente.
4. Build Docker externo com apenas build args públicos; imagem/tag imutável e
   checksum/registry digest registrado. Não usar latest nem embutir secrets.
5. Para mudança relevante, backup DB+Auth+Storage pré-deploy validado; preservar
   tag/digest/config anterior, compatibilidade schema/app e plano de recovery.
   Alteração puramente documental não exige novo backup completo.
6. Deploy somente aprovado, stop-first, uma réplica, preservando checkout remoto
   já dirty. Não sobrescrever mudanças do usuário nem criar segundo stack.
7. Healthchecks app/DB/Auth; buckets/URL legada privada; duas janelas automáticas
   de scheduler. Revisar filas/status sem WhatsApp novo/CAPI/cron de teste.

### Rollback

Rollback app: aplicar a tag/digest anterior registrada, SOMENTE se compatível
com schema/hardening atuais. Não voltar a imagem pré-21G reabrindo autorização
ou Storage. Confirmar app healthy, uma réplica, cron automático normal e auth.
Mudança de app e scheduler são independentes; a tag do scheduler exige revisão
do seu Config. O rollback também é ação aprovada, não automatizado nesta etapa.

Banco: nunca down migration destrutiva automática nem reabrir sent/failed/
delivery_unknown. Migration incompatível exige plano específico: forward-fix
ou recovery com janela aprovada, reconciliação de dados pós-backup, roles/extensões,
Auth persistente/config operacional e Storage bytes. Restaurar fora do banco ativo
e sem app/cron conectado durante ensaio; dump histórico não é cópia atual.
Incidente que exige suspender side effects precisa autorização e controle de
entrada/consumer; só parar scheduler não bloqueia WhatsApp/automações/webhook.
O kill-switch pre-cutover do plano antigo não é requisito de promoção in-place,
mas rollback não deve prometer bloqueio integral que não existe.

## Testes desta etapa e alterações locais

- 122 arquivos / 1452 testes Vitest PASS; typecheck PASS; build PASS.
- Lint reexecutado após scripts operacionais: 0 erros / 40 warnings legados.
- 18 testes Node de scheduler/equivalência e 3 novos testes offline de bloqueio
  do checker em cache/origem públicos: 21 PASS, nenhum HTTP real nesses testes.
- 138 observações/assertions PG17 PASS; fingerprints das 76 tabelas do DR intactos.
- 3 cenários concorrentes PG17 PASS, isolados; sem app/integrations no laboratório.
- Checksum/TOC/schema offline e Storage backup PASS; runtime check do avatar
  inicialmente FAIL por exposição de cache, **final PASS** após a única purga.
  Checker agora retorna exit 1 em exposição anônima de origem ou cache.
- Build warnings: lockfile externo/Turbopack root, middleware→proxy, Edge runtime
  deprecation e geração estática em página Edge. Não alterados fora de escopo.

Mudanças locais limitadas a scripts operacionais, checker e documentação.
Nenhum novo código de negócio, redeploy, migration ou alteração do banco ativo.
Documentos anteriores recebem banners SUPERADO; evidências históricas preservadas.
As modificações anteriores do usuário em production-topology-and-backup.md e os
quatro runbooks históricos ainda não versionados não foram sobrescritos/revertidos.

### Próxima ação, NÃO executada

Completar auditoria Auth administrativa read-only no projeto awganmhowivedfocwzjy
e decidir confirmação de e-mail/SMTP, sem alterar silenciosamente. Aprovar
destino/credenciais/criptografia antes de agendar backups diários.
Nenhuma dessas próximas ações foi executada. A formalização in-place não autoriza
aprovar findings desconhecidos nem torna este snapshot um backup recorrente.
