# Topologia de produção e backup/restore — plano 21B

DECISÃO PENDENTE. Nada deste documento autoriza criar/promover produção, fazer
backup ou restaurar banco real nesta etapa. `crm.luizangelo.com.br` continua no
stack `wacrm_staging`, banco `awganmhowivedfocwzjy`. Shodisparo fora de escopo.

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

Recomendação técnica: B para isolamento de testes e operação duradoura. A é
válida se a prioridade for preservar a instalação já em uso com menor migração,
desde que futuros testes sejam deslocados para outro staging. Escolha explícita
do usuário antes de qualquer ação. Nenhuma escolha foi executada.

## Pré-condições de backup futuro

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

## Comandos futuros: captura restrita, não executados em 21B

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
