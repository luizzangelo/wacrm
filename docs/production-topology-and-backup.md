# Topologia B e backup/restore — runbook 21C/21D

> SUPERADO quanto à topologia e aos planos de migração, freeze e cutover.
> A decisão final 21H é AMBIENTE ÚNICO PRODUTIVO: domínio CRM, Supabase
> `awganmhowivedfocwzjy` e stack legado `wacrm_staging` permanecem atuais.
> Não criar `wacrm-production`, segundo Auth/scheduler ou captura para migração.
> As evidências históricas de backup/DR abaixo permanecem preservadas.
> Runbook vigente: [produção in-place 21H](production-in-place-21h.md).

DECISÃO DEFINIDA pelo usuário: B — PRODUÇÃO SEPARADA. Na retomada da ETAPA 21D,
`crm.luizangelo.com.br` foi reservado como domínio FINAL DE PRODUÇÃO, substituindo
a sugestão histórica `app.luizangelo.com.br`. O domínio ainda serve o staging;
nenhum DNS/roteamento foi alterado. Stack `wacrm_staging` e banco
`awganmhowivedfocwzjy` continuam STAGING. Seu domínio futuro permanece indefinido.
Backup do staging e ensaio temporário isolado foram autorizados;
criar/promover/publicar produção, alterar o banco ativo ou Meta não foram.
Shodisparo fora de escopo. Estado do ensaio em
[21C — auditoria e bloqueio de execução](backup-restore-drill-21c.md) e
[21D — segundo restore validado e Storage capturado](backup-restore-drill-21d.md).

Reconciliação posterior, classificações e proposta (não executada) de freeze:
[21E — deltas e captura final](final-capture-and-delta-reconciliation-21e.md).
As letras A/B das estratégias de captura 21E não alteram a Topologia B aprovada.

## Requisito SaaS e gate de lançamento — 21F

Produção é MULTI-TENANT: uma aplicação e UM Supabase de produção compartilhado
por várias accounts isoladas logicamente. O projeto será separado do staging,
não um projeto por cliente. Uma account/usuário/WhatsApp no staging é somente
estado atual dos dados, nunca restrição para accounts 2, 3 e N. WhatsApp, WABA,
tokens, Dataset, pipelines e dados de cada cliente devem ser account-scoped.
A captura final representará apenas o tenant já existente.

**NO-GO PARA LANÇAMENTO** até corrigir e revalidar os bloqueios comprovados em
[21F — auditoria SaaS multi-tenant](saas-multi-tenant-audit-21f.md): vínculos
cross-account, notificação cruzada, INSERT de membership sem autorização em
usuário sem profile, statuses sem filtro de account, Storage público e
onboarding/autorização de configuração incompletos. Backup/restore aprovado
não supera esse gate. Nenhuma correção/produção/cutover foi autorizada ou
executada pela auditoria. O GO de 21E permanece apenas para planejamento.

## Decisão de topologia

| Aspecto | A — formalizar ambiente atual | B — produção separada |
| --- | --- | --- |
| Risco | Menor cutover inicial; testes passam a ter risco produtivo | Maior cutover inicial; isolamento permanente |
| Dados | Preservar banco/IDs/histórico, sem cópia inicial | Migração/restauração validada, preservando IDs e snapshots |
| Meta/WhatsApp | Preservar vínculo atual e um único webhook | Planejar cutover explícito; nunca dois consumidores/envios para o mesmo número |
| Downtime | Pequena janela de formalização/validação | Janela de congelamento, cópia final e cutover |
| DNS | Pode preservar domínio e roteamento | Subdomínio próprio; decidir se/quando o domínio atual muda |
| Secrets | Preservar ENCRYPTION_KEY necessária aos dados; inventariar/rotacionar com plano | Secrets separados; dados criptografados exigem chave original ou recriptografia controlada |
| Banco | Atual torna-se produtivo; staging futuro separado | Novo Supabase com Auth/RLS/roles/functions/Storage reconciliados |
| Scheduler | Uma réplica para esse banco/ambiente | Uma réplica produtiva; staging nunca pode enviar a fila produtiva |
| Rollback | Imagem/config anterior; rollback de DB separado, sem reabrir eventos terminais | Manter origem congelada até aceite; DNS/webhook/config de retorno planejados |
| Manutenção | Nome staging torna-se enganoso; formalizar inventário/controles | Separação clara, custo de operar dois ambientes |
| Dois ambientes | Não obrigatório no cutover, mas necessário para testes seguros contínuos | Sim, permanentes |

O comparativo A/B acima registra o racional histórico. O usuário escolheu B:
isolamento permanente de testes e operação. A não será executada. Os recursos
produtivos abaixo são apenas planejamento; nenhum foi criado.

## Inventário da futura produção — somente planejado

| Recurso | Plano separado |
| --- | --- |
| Domínio final aprovado | crm.luizangelo.com.br; reservado para produção final, sem DNS/cutover nesta etapa |
| Stack | wacrm_production; não criado |
| Supabase | Projeto novo dedicado, referência ainda não definida; não criado |
| Scheduler | wacrm_production_meta_conversions_scheduler, uma réplica; não criado |
| Secrets | Nomes/valores produtivos próprios; nunca apontar ao secret/DB do staging |
| Rede/Traefik | Roteamento e labels exclusivos; integração à rede existente só após aprovação/capacidade |
| Volumes | Planejar conforme necessidade; app standalone sem volume de dados, Storage no projeto próprio |
| Backup | Destino fora da VPS, acesso restrito, retenção/RPO/RTO e restores comprovados |
| WhatsApp/Meta | Definir explicitamente número, WABA, Dataset, App, webhook e tokens; não copiar o vínculo ativo silenciosamente |

Se houver cutover do mesmo número oficial, definir uma janela e UM consumidor de
webhook, sem duplicar envio/scheduler. Se staging permanecer conectado a esse
número, produção precisa de uma configuração explicitamente distinta. Nenhuma
opção Meta foi executada nem escolhida silenciosamente.
O mesmo scheduler genérico será configurado com URL interna e path de secret
produtivos, sem acesso ao banco/fila staging. Secrets novos não conseguem
descriptografar tokens legados por si sós: dados copiados exigem a ENCRYPTION_KEY
correspondente ou recriptografia controlada e aprovada.

## Pré-condições de execução do backup

Destino local aprovado e utilizado em 21D:
`/Users/luizangelo/Backups/wacrm/staging/2026-09-17_145605`, fora do Git/VPS e de
Documents, em volume com FileVault ativo. Diretório 0700; dump, checksum e
inventários gerados 0600. O custom dump foi capturado e sua integridade/TOC
validadas. Após autorização de reconciliação global de roles, o segundo restore
passou e os bytes do único objeto Storage foram capturados com checksum válido.
As 76 tabelas restauradas coincidem com o inventário da época do dump; a origem
ativa atual não é idêntica (deals atuais 2 versus captura/restore 3).
Não usar este arquivo como cópia atual de cutover sem revisão da diferença
temporal, congelamento e autorização para captura final. Laboratório encerrado;
dump, Storage e evidências preservados. Nenhuma produção/DNS/cutover executado.
Não salvar o backup principal permanentemente/somente na raiz da VPS. A utilização
passou de 93% no início a 65% no fechamento (13G livres), sem cleanup executado
por esta etapa. Destino fora da VPS continua obrigatório para recuperação.
O banco inteiro estimado em 21C tem 15 MB; custom dump real em 21D: 855768 bytes.

O bloqueio de credencial de 21C foi superado manualmente pelo usuário em 21D:
service `wacrm_staging` em `/Users/luizangelo/.pg_service.conf` e password file
`/Users/luizangelo/.pgpass`, ambos 0600. O password file não foi lido nem impresso
pelo agente; apenas libpq o utiliza. Session Pooler oficial confirmado pelo
usuário e conexão cliente TLS 1.3 verificada. `sslmode=require` cifra a conexão;
esta etapa não comprovou validação da identidade do servidor por `verify-full`.
Clientes locais 17.5, servidor staging 17.6. O acesso MCP read-only e a
service-role API key NÃO substituem credencial PostgreSQL. Não
resetar senha, criar cli_login_postgres, alterar grants ou escrever no staging
para contornar o bloqueio. Confirmar hostname/usuário/porta real do Session pooler
pelo Connect; não escolher endpoint por tentativa de senhas.

- Definir origem/destino, janela, RPO/RTO, operador, retenção, espaço livre e
  armazenamento off-site criptografado. Nesta auditoria o PostgreSQL staging é
  17.6; usar `pg_dump`/`pg_restore` major 17 atualizados e registrar `--version`.
- Identificar conexão direta ou pooler SESSION (5432), nunca transaction pooler
  para dump/restore. Obter parâmetros pelo canal autorizado; senha de DB não é
  service-role key. Não resetar senha sem aprovação. Não colar URI com senha em
  terminal/logs/chat/Git. Configurar libpq service file e password file 0600,
  criados em editor seguro, sem shell tracing. TLS deve validar o certificado.
- Perfil libpq `wacrm_source`: host, port, dbname, user, sslmode e certificados,
  sem senha. Password file separado. Destino isolado `wacrm_restore_lab` com
  identidade verificada; nunca reutilizar o perfil de origem para restore.
- Inventariar schemas e TOC esperado: public, auth, storage (metadados),
  supabase_migrations, extensões e objetos específicos. Não considerar dump
  parcial que omite Auth/Storage/histórico um backup completo.
- Bloquear rede externa no laboratório, não montar secrets Meta/cron, não subir
  scheduler/app/webhook produtivo. Desabilitar jobs/integrações que executem
  operações externas na cópia. Restore pode copiar pg_cron/pg_net/wrappers.

## Comandos de referência para captura restrita

Em 21D foi executado o custom dump nativo via `service=wacrm_staging`, com
`default_transaction_read_only=on`; não foi usado o perfil exemplificativo
`wacrm_source` abaixo. Export global de roles por pg_dumpall NÃO foi executado;
atributos não secretos e memberships foram inventariados por SELECT.

Os caminhos abaixo são exemplos de local previamente provisionado com modo
0700; arquivos 0600 (`umask 077`). Não usar credenciais reais nos argumentos.

```sh
pg_dump --version
pg_restore --version
PGSERVICEFILE=/secure/wacrm/libpq-services.conf PGPASSFILE=/secure/wacrm/pgpass \
  psql 'service=wacrm_source' -X -v ON_ERROR_STOP=1 \
  -c 'SELECT current_database(), current_setting('"'"'server_version'"'"');'
PGSERVICEFILE=/secure/wacrm/libpq-services.conf PGPASSFILE=/secure/wacrm/pgpass \
  pg_dump --dbname='service=wacrm_source' --format=custom \
  --file=/var/backups/wacrm/APPROVED_RUN/database.dump
sha256sum /var/backups/wacrm/APPROVED_RUN/database.dump
pg_restore --list /var/backups/wacrm/APPROVED_RUN/database.dump
```

Dump lógico precisa de privilégios suficientes para todos os dados/RLS. Não
usar `--enable-row-security` para mascarar perda de linhas. Em Supabase, validar
explicitamente compatibilidade dos schemas gerenciados/ownership/extensões;
erros não são aceitáveis. `pg_dump` não captura roles globais: arquivar definições
de roles/membership/grants sem passwords (`pg_dumpall --roles-only
--no-role-passwords`, se autorizado pelo provedor), ou export oficial filtrado
Supabase. Não restaurar indiscriminadamente roles reservadas gerenciadas.

Usar `pg_dump`/`pg_restore` major 17 com minor atualizado e verificar versões.
Não reutilizar pg_dump 15/16 de outros serviços da VPS. Não habilitar dump parcial
silenciosamente quando um schema gerenciado der permission denied. Manter dump
original intacto e relatório de cobertura; se for necessário um archive filtrado
para o laboratório, registrar exatamente objetos omitidos, motivo, checksum
separado e limitações. Sem cobertura dos objetos críticos, o ensaio fica FAIL.
Um PG17 genérico pode não suportar supabase_vault/vector: provisionar imagem
compatível confiável antes do restore; não fabricar stubs de funções/extensões
para declarar recuperação completa.

Cada componente deve entrar no manifest: checksum, versão de ferramentas,
origem não secreta, instante início/fim, contagens, schemas, TOC, permissões,
criptografia e destino off-site. Dump separado de Auth/Storage/ledger, se exigido
pelo provedor, deve usar snapshot consistente coordenado; não declarar uma
cópia consistente de arquivos capturados em instantes diferentes com writes ativos.

## Restore isolado

Primeiro testar em PostgreSQL 17 descartável sem egress, com extensões e roles
equivalentes provisionadas. Inspecionar TOC/SQL confiável antes de executar.
Para banco totalmente vazio, restore completo ordena pre-data/data/post-data;
custom triggers são instalados após dados, evitando bootstrap/auto-deal duplicado.
Não restaurar sobre schema WACRM já migrado: triggers existentes podem criar
deals/eventos/notifications durante importação. Se o destino tiver bootstrap
Supabase, usar roteiro compatível por schema e desativação de triggers apenas
durante importação, em laboratório, com privilégios autorizados; `--disable-triggers`
é para data-only e exige superuser. Sem esse privilégio, parar e adaptar o plano
com o provedor; não ignorar erros nem executar contra origem.

```sh
PGSERVICEFILE=/secure/wacrm/libpq-services.conf PGPASSFILE=/secure/wacrm/pgpass \
  pg_restore --dbname='service=wacrm_restore_lab' --single-transaction \
  --exit-on-error /var/backups/wacrm/APPROVED_RUN/database.dump
```

Esse comando é para laboratório vazio compatível, não para substituir fluxo
gerenciado Supabase. Preservar owners e ACLs quando as roles equivalentes
existirem; não usar `--no-acl`/`--no-owner` para esconder falhas e declarar RLS
validada. Futuro Supabase novo exige o procedimento oficial, tratamento de roles
gerenciadas, modificações customizadas auth/storage e migration history separado.
Restore manual entre projetos pode exigir cópia da encryption root key para
Vault/colunas dependentes; o fluxo gerenciado de clone copia essa chave.

## Auth, Storage e configuração fora do dump

Antes de produção: validar disponibilidade e habilitar proteção de senhas vazadas
do Auth, ou aprovar controle equivalente; o advisor atual registra-a desativada.
Nenhuma configuração Auth foi alterada em 21B.

- Auth: users e hashes de senhas, identities e objetos relacionados. Preservar
  UUIDs; não disparar signup trigger durante importação. Configurar SMTP,
  providers, redirect URLs/domínio e políticas externas separadamente. Outro
  signing key/JWT secret pode exigir novo login; não copiar/rotacionar JWTs
  silenciosamente. Keys anon/service-role novas não substituem ENCRYPTION_KEY.
- Storage: SQL contém somente metadados. Copiar os bytes dos buckets (inclusive
  chat-media), paths/políticas/config, gerar inventário de tamanho/checksum e
  verificar objetos amostrados autenticados. Sem cópia de objetos, backup incompleto.
- Separar inventário cifrado de ENCRYPTION_KEY, secrets Docker, configuração de
  Auth/Realtime/Storage, DNS/Traefik, configs de scheduler e imagem imutável.
  Nunca incluir esses valores em dump público ou relatório.

## Aceite pós-restore obrigatório

Comparar contagens e hashes protegidos de dados: accounts/profiles, contacts,
conversations/messages, deals/stages/loss history, attributions e eventos Meta.
Preservar event_id/status/attempts/sent_at: failed/sent/delivery_unknown nunca
voltam a pending. Comparar funções/owners/search_path/grants, policies e RLS
enabled, índices/uniques, triggers, extensões e ledger SQL/checksum. Testar tenant
A/B, login novo, permissões anon/auth/service, joins/deal cards/dashboard e
diagnostics sem Graph API. Verificar decrypt apenas booleano, sem imprimir tokens.
Nenhum teste de restore pode enviar WhatsApp/CAPI. Registrar restore duration,
falhas e evidência de recuperação. Backup plan PRONTO não significa backup
EXECUTADO ou restore ENSAIADO; GO produtivo depende do ensaio aprovado.

Referências primárias:
[Supabase backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[Auth](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects),
[clone e Storage](https://supabase.com/docs/guides/platform/clone-project),
[pg_dump 17](https://www.postgresql.org/docs/17/app-pgdump.html),
[pg_restore 17](https://www.postgresql.org/docs/17/app-pgrestore.html),
[libpq](https://www.postgresql.org/docs/17/libpq-envars.html).
