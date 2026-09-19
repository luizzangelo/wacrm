# ETAPA 21D — backup real e interrupção antes do restore

> HISTÓRICO PRESERVADO. Restore drill anterior PASS continua válido como
> evidência de recuperabilidade; não é uma cópia atual de produção.
> Topologia separada, captura para migração, freeze e cutover estão SUPERADOS.
> Novo backup externo e operação produtiva atual: [21H in-place](production-in-place-21h.md).

Estado atual: BACKUP SQL ÍNTEGRO; SEGUNDO RESTORE PASS; STORAGE BYTES PASS.
Dados restaurados coincidem com o inventário da época do dump nas 76 tabelas.
Origem ativa mudou depois da captura: deals atuais 2, restore histórico 3.
NO-GO para usar este backup como cópia atual de produção sem reconciliar essa
diferença temporal e planejar captura final/cutover. Nenhuma produção criada.
A primeira preparação parou no download de libsodium; o primeiro restore
falhou por role local pgbouncer ausente. Após NOVA autorização, o inventário
global de roles foi reconciliado e o segundo restore passou. O laboratório
foi encerrado após as validações; backup e objetos Storage foram preservados.
As seções históricas abaixo distinguem as tentativas; resultado atual em
"Segunda retomada — roles reconciliadas e restore validado".

Os deltas posteriores foram reconciliados read-only na
[Etapa 21E](final-capture-and-delta-reconciliation-21e.md): exclusão de um deal
em Venda perdida, SET NULL do vínculo do evento e renovação/presença Auth.
Nenhuma restauração adicional nem captura final foi executada nessa etapa.

## Topologia final aprovada na retomada

- Produção futura: `https://crm.luizangelo.com.br`, stack `wacrm_production`,
  projeto Supabase separado e scheduler `wacrm_production_meta_conversions_scheduler`.
- Staging atual: `wacrm_staging`, projeto `awganmhowivedfocwzjy`; domínio futuro
  de staging ainda não definido/aplicado.
- O domínio CRM está reservado à produção FINAL, mas seu roteamento atual não
  foi alterado. A antiga sugestão `app.luizangelo.com.br` foi substituída.
- Nenhum projeto/stack/domínio produtivo foi criado; nenhum DNS foi alterado.

## Conexão e proteção local

Preparação manual do usuário: `/Users/luizangelo/.pg_service.conf` e
`/Users/luizangelo/.pgpass`, ambos 0600, service `wacrm_staging`.
O agente verificou somente metadata/permissões do password file, sem ler,
imprimir ou reproduzir seu conteúdo. Autenticação foi feita diretamente por libpq.

Session Pooler informado pelo usuário: `aws-0-us-east-1.pooler.supabase.com`,
porta 5432, database `postgres`, user `postgres.awganmhowivedfocwzjy`.
`sslmode=require`; cliente confirmou TLS 1.3 / TLS_AES_256_GCM_SHA384.
`pg_stat_ssl` no backend mostrou false: esse resultado corresponde ao trecho
Pooler → PostgreSQL, não invalida a sessão TLS cliente → Pooler confirmada por
`psql \conninfo`. Não foi comprovado `verify-full` nesta etapa.

Clientes JÁ EXISTIAM por preparação manual: psql/pg_dump/pg_restore 17.5 em
`/Library/PostgreSQL/17/bin`; servidor staging 17.6. FileVault: On.
Destino aprovado, fora do Git e da VPS:
`/Users/luizangelo/Backups/wacrm/staging/2026-09-17_145605` (0700).
Artefatos de backup/inventário gerados com umask 077 e modo 0600.

Nenhuma senha, URI com senha, service key ou ENCRYPTION_KEY aparece neste runbook.
O dump contém dados sensíveis e tokens criptografados: NÃO publicar/anexar ao Git.

## Backup realmente executado

`pg_dump --dbname=service=wacrm_staging --no-password --format=custom`.
Origem protegida com `PGOPTIONS=-c default_transaction_read_only=on`.
Sem filtro de schemas, sem `--enable-row-security`, sem alteração de privilégios.

- Início UTC: 2026-09-17T17:58:31.001Z.
- Fim UTC: 2026-09-17T17:59:37.758Z.
- Duração: 66.757 segundos.
- Exit code: 0.
- Arquivo: `database.dump`; tamanho: 855768 bytes.
- SHA-256 calculado e revalidado: PASS; arquivo `database.dump.sha256`.
- `pg_restore --list`: PASS; inventário `database.toc`.
- TOC contém tabelas críticas public, auth.users/auth.identities,
  storage.buckets/storage.objects e supabase_migrations.schema_migrations.
- Extração offline `pg_restore --schema-only --file=database-schema.sql`: PASS.

Outros artefatos protegidos: `backup-result.json`, `origin-before.json`,
`origin-catalog.json`, `origin-data.json`, queries de catálogo/comparação e log
de pg_dump. Não são públicos. Os fingerprints agregados não são impressos.
O catálogo read-only inventariou 76 tabelas de dados, 788 colunas, 332 constraints,
283 índices, 66 funções/procedures não membros de extensões, 123 policies e
39 triggers nos schemas public/auth/storage/supabase_migrations.
Roles sem passwords e memberships foram inventariados, não restaurados.

A leitura inicial e a leitura posterior de fingerprints não compartilham um
snapshot exportado com pg_dump. O dump tem sua própria snapshot consistente;
não alegar igualdade origem/restore ou snapshot coordenada enquanto não validada.

## Histórico: contagens iniciais antes das retomadas

Snapshot de inventário inicial UTC: 2026-09-17T17:58:30.939558Z.

| Relação | Origem | Restore |
| --- | ---: | --- |
| accounts | 1 | NÃO EXECUTADO |
| profiles | 1 | NÃO EXECUTADO |
| contacts | 3 | NÃO EXECUTADO |
| conversations | 3 | NÃO EXECUTADO |
| messages | 22 | NÃO EXECUTADO |
| whatsapp_config | 1 | NÃO EXECUTADO |
| pipelines | 1 | NÃO EXECUTADO |
| pipeline_stages | 5 | NÃO EXECUTADO |
| deals | 3 | NÃO EXECUTADO |
| deal_loss_events | 1 | NÃO EXECUTADO |
| meta_ad_attributions | 2 | NÃO EXECUTADO |
| meta_conversion_config | 1 | NÃO EXECUTADO |
| meta_conversion_events | 8 | NÃO EXECUTADO |
| auth.users | 1 | NÃO EXECUTADO |
| auth.identities | 1 | NÃO EXECUTADO |
| storage.buckets | 3 | NÃO EXECUTADO |
| storage.objects | 1 | NÃO EXECUTADO |
| supabase_migrations.schema_migrations | 47 | NÃO EXECUTADO |

Fila inicial: pending 0, sending 0. A leitura posterior de origem ainda tinha
8 eventos Meta. Nenhum evento foi criado por ação desta etapa. Não houve chamada
manual de cron, POST /events, uso de tokens Meta, envio WhatsApp ou movimento de deal.
O scheduler existente não foi pausado/alterado; essas afirmações não representam
auditoria de todos os efeitos de serviços independentes durante toda a janela.

## Histórico da primeira tentativa — somente preparação

Docker local ausente. PostgreSQL nativo 17.5 foi encontrado no instalador EDB;
sua instância já existente NÃO foi modificada/usada para restore.
Foi feita cópia privada de bin/lib/share/include em `restore-lab/runtime` dentro
do diretório aprovado. Não houve initdb, start, conexão ao laboratório, criação
de roles ou execução de pg_restore contra DB. Runtime da aplicação não foi alterado.

O dump precisa de extensões:

| Extension | Origem |
| --- | --- |
| plpgsql | 1.0 |
| pgcrypto | 1.3 |
| uuid-ossp | 1.1 |
| pg_stat_statements | 1.11 |
| vector | 0.8.2 |
| supabase_vault | 0.3.1 |

O instalador nativo não inclui vector/Vault. Seus sources oficiais foram obtidos
para preparação local, sem execução/instalação global:
vector tag v0.8.2, commit `cab9da72c04353f143bb06b42ab70a403daac64a`;
Vault tag v0.3.1, commit `6e0cd916242d922a646e4d611cc215e09dd429f4`.
Vault depende de libsodium. O download oficial de libsodium 1.0.22 falhou com:

`curl: (92) HTTP/2 stream 1 was not closed cleanly: PROTOCOL_ERROR (err 1)`.

O tar confirmou `truncated gzip input` e retornou erro. O arquivo parcial NÃO
foi considerado íntegro/confiável nem usado em build. Não houve retry ou tentativa
de restore sem a extensão. Dump original permanece separado e intacto.
Preparação/arquivos parciais mantidos intencionalmente; nenhuma exclusão/prune.

## Histórico: validações pendentes antes da segunda retomada

Origem × restore, dados, schema recente, FKs/constraints/índices, RPC hardening,
owners/search_path/EXECUTE grants, policies/RLS e migration history no destino.
Não criar stubs de funções ou esconder incompatibilidades para declarar PASS.
Respeitar a reconciliação SQL/SHA-256 21B/21C: timestamps históricos diferentes
não autorizam reaplicar migrations nem reparar o ledger staging.

Auth users/identities e Storage metadata constam do TOC, mas suas contagens
restauradas não foram verificadas. Os bytes do único objeto Storage NÃO foram
baixados; inventário de objetos/checksums separado ainda não foi criado.
Backup SQL íntegro NÃO significa recuperação completa comprovada.

A mesma ENCRYPTION_KEY será necessária numa recuperação real dos tokens
criptografados; não foi copiada/exportada/descriptografada nesta etapa nem será
inserida no laboratório. A chave raiz Vault é distinta; sem validação compatível
não alegar recuperação de secrets Vault.

Fora do dump, ainda inventariar/recriar em futura produção: Auth settings,
redirect URLs do domínio final, SMTP, providers, project secrets, Storage bucket
config/bytes, API settings, Realtime publications e Edge Functions, se houver.
Não alterar Auth staging. Proteção de senhas vazadas: último estado conhecido
21C INATIVA, não reconsultada após interrupção em 21D. Quando disponível no plano,
avaliar habilitação futura aprovada e controles de comprimento/complexidade,
rate limiting, email verification e MFA; configurações atuais não revalidadas.

App/scheduler staging, intervalo 120s e restarts não foram revalidados após a
interrupção; não usar evidência antiga como prova de saúde atual.

## Retomada autorizada — runtime validado, restore interrompido

Docker no Mac foi novamente verificado: ausente. Escolhido fallback nativo
privado PostgreSQL 17.5; nenhuma instalação global ou alteração na instância
EDB existente. O checksum original `database.dump.sha256` foi revalidado: PASS.

### Dependências e integridade

Novo download oficial de libsodium 1.0.22 via HTTP/1.1, em
`restore-lab/sources/libsodium-1.0.22.tar.gz`, completo: 2008529 bytes.
Assinatura Ed25519 de distribuição e assinatura do trusted comment verificadas
com Node crypto e chave pública publicada na documentação oficial: PASS/PASS.
SHA-256 do source:
`adbdd8f16149e81ac6078a03aca6fc03b592b89ef7b5ed83841c086191be3349`.
Nenhum source parcial foi reutilizado. Foi removido SOMENTE o archive truncado
anterior, `libsodium-1.0.22.tar.gz` na raiz deste backup (229376 bytes); ele não
foi enviado à lixeira. Dump e todos os demais arquivos foram preservados.

Build/install estáticos de libsodium somente em `restore-lab/deps`: PASS.
`make check`: 101 testes, 101 PASS, zero FAIL/SKIP/ERROR.
Vector 0.8.2 e Vault 0.3.1 compilados dos sources oficiais já registrados e
instalados somente em `restore-lab/runtime`.
O primeiro build de vector encontrou SDK antigo inexistente no PGXS do EDB;
resolvido especificando o SDK local real por argumento de make, sem editar
runtime da aplicação ou instalação PostgreSQL global.

### Laboratório efetivamente criado e isolado

Cluster separado `restore-lab/data`, database `wacrm_restore_drill`, PG 17.5.
Locale provider ICU/en-US, UTF8; bibliotecas ICU e minor version nativos podem
diferir da plataforma. Não considerar o laboratório um clone completo Supabase.
Autenticação local SCRAM com senha forte fictícia gerada só para o laboratório.
Nenhuma senha de role real, ENCRYPTION_KEY ou secret Meta/WhatsApp/cron montado.
Environment do processo foi restrito; não herdou env/secrets da aplicação.

Socket Unix em diretório privado temporário 0700. `listen_addresses=''`, sem
listener TCP, sem app, scheduler, webhook ou automações. O processo PostgreSQL
foi iniciado sob sandbox macOS bloqueando rede IPv4/IPv6 inbound/outbound.
Teste de bloqueio de conexão IP sob a mesma policy retornou EPERM: PASS.

Todas as seis extensões foram criadas e consultadas no laboratório, nas mesmas
versões E owners da origem: plpgsql 1.0, pg_stat_statements 1.11, pgcrypto 1.3,
uuid-ossp 1.1, vector 0.8.2 e supabase_vault 0.3.1.
Vault não foi preloaded; nenhuma chave raiz gerenciada foi usada e nenhum token
ou secret foi descriptografado. Origem Vault reconsultada read-only: zero secrets.

Foram criadas nove roles NOLOGIN mínimas, além da bootstrap local supabase_admin,
preservando INHERIT/BYPASSRLS relevantes e memberships entre roles disponíveis.
Credenciais reais e privilégios globais desnecessários não foram copiados.
Postgres foi elevado temporariamente SOMENTE no lab para instalar extensões
não trusted com owner correto, retornando a NOSUPERUSER antes do restore.
Supabase real ainda difere em login/passwords e privilégios globais de roles.

Na preparação, um comando que juntava bootstrap de roles e CREATE DATABASE
falhou por `CREATE DATABASE cannot run inside a transaction block`; a transação
foi revertida e a criação foi separada em comandos próprios, com exit code 0.
Esses ajustes foram apenas de preparação local, anteriores à única execução
de pg_restore. Não esconder esses erros resolvidos como warnings do restore.

TOC derivado `restore-lab/restore.toc`: somente as entradas CREATE SCHEMA
extensions/vault foram marcadas como pré-provisionadas. Seus schemas, owners e
extensões já existiam; ACLs/comments e demais entradas permaneceram selecionados.
Nenhum objeto de dados/constraint/function foi excluído da lista para mascarar erro.
Dump original nunca foi alterado.

### Única execução de restore e erro

Executado pg_restore 17.5 com `--single-transaction --exit-on-error`, preservando
owners/ACLs, para o socket/database do laboratório, nunca para o service staging.

- Início UTC: 2026-09-17T21:08:50.734Z.
- Fim UTC: 2026-09-17T21:08:51.053Z.
- Duração: 0.319 segundos.
- Exit code: 1; resultado FAIL.
- Warnings do restore: nenhum registrado.
- Erro: `ERROR: role "pgbouncer" does not exist`.
- Comando: `ALTER SCHEMA pgbouncer OWNER TO pgbouncer`.

O inventário anterior de roles filtrava `rolname NOT LIKE 'pg_%'`; underscore
é wildcard em LIKE e esse filtro também exclui `pgbouncer`, que NÃO é uma role
builtin pg_. Assim ela não entrou na preparação. Corrigir futuramente o filtro
para um prefixo literal (por exemplo `rolname !~ '^pg_'`) e reconciliar TODOS
os owners/grantees do archive antes de uma nova tentativa. NÃO corrigido/reexecutado
nesta retomada, respeitando a regra de interrupção após erro de restore.

Rollback comprovado por catálogo local após falha: zero tabelas public de
aplicação, schema auth ausente e schema supabase_migrations ausente.
Dados/schema da aplicação não foram restaurados; não há comparações PASS.
Servidor do laboratório encerrado com pg_ctl fast, exit code 0. Arquivos/runtime
e credenciais fictícias protegidas mantidos; nenhuma exclusão de dados/volume.

Artefatos locais adicionais: `libsodium-integrity.json`, logs de build/check,
`lab-state.json`, `bootstrap-result.json`, `restore-result.json`, `pg_restore.log`
e `rollback-and-stop-result.json`, todos dentro do destino protegido.

Origem reconsultada antes do restore, read-only: PG 17.6, eventos Meta 8,
pending 0, sending 0, Vault secrets 0. Nenhum cron manual/POST events/integração
externa foi executado pelo laboratório ou pelo agente. Após a falha não houve
novas operações na origem nem final health check de app/scheduler.
Storage bytes continuam pendentes; Auth/metadata/ledger/ACLs no restore não
validados. Topologia final permanece CRM reservado para produção futura.

## Segunda retomada — roles reconciliadas e restore validado

Autorização explícita permitiu inventariar todas as roles do dump, criar os
stubs locais necessários, recriar SOMENTE wacrm_restore_drill e repetir o
restore. Nenhum novo dump, rebuild de libsodium/vector/Vault ou alteração
remota foi realizado. Checksum original do dump revalidado: PASS.

### Inventário global de roles

Foram analisados OWNER TO, GRANT/REVOKE, default privileges e owners do TOC,
sem filtro de prefixo e sem imprimir conteúdo de dados. PUBLIC é pseudo-role.
O TOC também identifica pg_database_owner, builtin existente, que não precisa
de CREATE ROLE mesmo quando não há ALTER OWNER explícito no SQL gerado.
Inventário incluiu 209 comandos de owner e 1178 de ACL/default privileges.

Onze roles referenciadas:
anon, authenticated, dashboard_user, pg_database_owner, pgbouncer, postgres,
service_role, supabase_admin, supabase_auth_admin, supabase_realtime_admin,
supabase_storage_admin.

Cluster local tinha 25 roles, dez das onze referências já existentes; a única
faltante era pgbouncer. Criado SOMENTE o stub pgbouncer NOLOGIN NOSUPERUSER
NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS, sem password.
Os dez stubs acumulados de preparação/restore, incluindo authenticator de
preparação anterior, foram consultados em pg_authid SOMENTE como booleanos:
todos NOLOGIN, password_present=false. Bootstrap supabase_admin é separada,
com password fictícia local; nenhuma password de role remota foi copiada.
Os stubs permitem ownership/ACLs e não reproduzem a segurança operacional,
login, passwords, serviços gerenciados ou todos os atributos globais Supabase.

### Destino limpo e segundo restore

Identidade do cluster confirmada por current_setting(data_directory).
DROP DATABASE foi executado SOMENTE em wacrm_restore_drill, criado para este
drill, seguido de CREATE DATABASE vazio. Cluster, outros bancos, runtime,
libsodium, binários das extensões e backup foram mantidos. As extensões foram
habilitadas novamente nesse database novo, sem recompilar/reinstalar binários.
Mesmas seis versões e owners da origem; dois schemas preprovisionados conforme
TOC derivado anterior. Nenhum objeto de dados/ACL foi omitido.

Segundo pg_restore: single-transaction/exit-on-error, owners e ACLs preservados.

- Início UTC: 2026-09-17T21:26:19.508Z.
- Fim UTC: 2026-09-17T21:26:19.827Z.
- Duração: 0.319 segundos.
- Exit code 0, PASS; zero warnings e erros.
- Objetos necessários presentes e validados, não apenas exit code.

### Comparação com snapshot histórica e origem atual

Consultas de origem foram read-only com default_transaction_read_only=on.
Contagens e fingerprints agregados foram comparados SEM exibir PII/hash de
cliente. A comparação foi padronizada com SET LOCAL TIME ZONE UTC, porque
to_jsonb(timestamptz) renderiza offsets conforme timezone da sessão; diferenças
de offset não representam diferenças de dados. Nenhum dado foi normalizado
ou reescrito no banco; apenas representação de consulta.

Origem inventariada na época do dump × restore: 76/76 tabelas com contagens e
fingerprints agregados idênticos, PASS. Esse inventário foi coletado separado
do snapshot interno pg_dump; não declarar uma exportação coordenada. A igualdade
efetivamente constatada demonstra fidelidade desses dados capturados.

| Relação | Na época do dump | Restore | Origem atual |
| --- | ---: | ---: | ---: |
| accounts | 1 | 1 | 1 |
| profiles | 1 | 1 | 1 |
| contacts | 3 | 3 | 3 |
| conversations | 3 | 3 | 3 |
| messages | 22 | 22 | 22 |
| pipelines | 1 | 1 | 1 |
| pipeline_stages | 5 | 5 | 5 |
| deals | 3 | 3 | 2 |
| deal_loss_events | 1 | 1 | 1 |
| meta_ad_attributions | 2 | 2 | 2 |
| meta_conversion_config | 1 | 1 | 1 |
| meta_conversion_events | 8 | 8 | 8 |
| auth.users | 1 | 1 | 1 |
| auth.identities | 1 | 1 | 1 |
| supabase_migrations.schema_migrations | 47 | 47 | 47 |
| storage.buckets | 3 | 3 | 3 |
| storage.objects | 1 | 1 | 1 |

Origem ATUAL × restore histórico não são cópias idênticas: deals 2/3 e
auth.refresh_tokens 78/77; alterações de conteúdo em auth.sessions/auth.users,
member_presence e meta_conversion_events. Não atribuir essas mudanças ao
restore nem identificar o autor sem auditoria própria. Não houve escrita
do agente na origem. Contagens atuais não foram substituídas por números antigos.
Nos oito eventos Meta, IDs/event_ids são os mesmos, sem inserção/exclusão;
status, attempts e sent_at não mudaram. Um LeadSubmitted tem deal_id diferente
entre captura/origem atual, consistente com mudança de relacionamento; não
foram resetados/reexecutados eventos para obter igualdade artificial.

### Catálogos, constraints, funções e hardening

Origem atual × restore, equality PASS para:
788 colunas, 332 constraints, 283 índices, 66 functions/procedures não membros
de extensões, 123 policies, 77 relações, 39 triggers e seis extensões.
ACLs foram comparadas semanticamente, ordenando arrays, além de owners,
SECURITY DEFINER, search_path e privilégios EXECUTE efetivos dos três papéis.

Confirmados is_lost_stage, lost_reason/lost_reason_notes, deal_loss_events,
deals.conversation_id/meta_attribution_id, campos attribution/conversion/status,
triggers de inbound e lifecycle. Presentes funções create_deal_on_whatsapp_inbound,
move_deal_to_stage_with_conversion_intent, guard_deal_lifecycle,
record_deal_loss_occurrence e RPCs de membership.
Validados lost_stage_unmapped, índice único idx_pipeline_stages_one_lost,
constraint require_pipeline_lost_stage, motivos/notes de perda, FKs tenant/account,
attribution/contact/conversation/config e Meta uniqueness por conta/deal/evento.
Contacts mantém unique account/phone_normalized. Nenhuma mutation de teste ou
RPC destrutiva executada.

Seis RPCs internas: invoker, owner postgres, search_path pg_catalog/public/pg_temp,
anon_execute=false, authenticated_execute=false, service_execute=true: PASS.
Isto foi verificado pelos grants/definições e has_function_privilege, NÃO pelo
NOLOGIN dos stubs. Definições/grants das RPCs de membership coincidem com origem,
preservando as exceções públicas deliberadas documentadas em 21B/21C.

Ledger completo 47/47 com dados/fingerprint iguais. Migration de hardening
staging/restore 20260917163719: SQL igual, checksum normalizado igual ao arquivo
Git 20260917161334_security_hardening_privileged_rpcs.sql. Respeitada reconciliação
existente: nenhum repair, replay ou migration aplicada no staging.

Auth users/identities 1/1 cada, sem login ou exposição de email/UUID/hash/metadata.
Auth restore estrutural/de dados PASS; isso NÃO valida configuração externa de
SMTP/providers/redirects/password protection no futuro projeto.

### Storage separado e destino seguro

Metadata buckets/objects coincidem com captura/restore e origem atual.
Avatars 1 objeto, chat-media 0, flow-media 0. Único avatar baixado por GET público
do projeto/bucket confirmado, sem service key, signed URL, exibição de conteúdo
ou upload/modificação na origem.
Bytes: 392255, iguais à metadata esperada. Arquivo em storage/avatars com path
original preservado; inventário protegido storage/inventory.json contém bucket,
path, size, sha256 e metadata. Nenhum path pessoal ou conteúdo impresso no runbook.
storage/objects.sha256 gerado; SHA-256 dos bytes recebidos e relidos em disco
idêntico, PASS. Diretórios 0700 e arquivo/inventário 0600, em Mac/FileVault ativo,
fora do Git/VPS. Dump original e checksum preservados.

### Saúde final e encerramento

VPS lida via SSH, sem mudança:
wacrm_staging_app 1/1 healthy, RestartCount 0, iniciado UTC 16:41:40;
wacrm_staging_meta_conversions_scheduler 1/1 healthy, RestartCount 0, iniciado
UTC 16:41:50. Tasks históricas de deploy não são restarts desta etapa.
Ciclos recentes entre UTC 21:15:51 e 21:27:52: intervalo 120000 ms, HTTP 200,
processed 0. Cron manual NÃO executado, POST /events NÃO executado pela etapa.
Meta events 8→8, zero IDs novos, fila pending/sending 0/0.
Nenhuma integração externa executada pelo laboratório/agente.

Laboratório encerrado com pg_ctl fast, exit code 0; arquivos mantidos como
evidência, sem prune ou exclusão do backup. Somente o database descartável anterior
foi removido/recriado, conforme autorização; seu conteúdo era o bootstrap local.
Produção, DNS, Meta/WhatsApp/Auth remoto e Shodisparo não alterados.

Artefatos finais protegidos em restore-lab: roles-global-inventory.json,
roles-final-validation.json, restore-result-2.json, pg_restore-2.log,
catálogos e dados de comparação UTC, validation-result.json (primeira comparação
sem padronização UTC), data-comparison-utc.json (resultado canônico definitivo),
final-detail-result.json, schema-security-evidence.json e final-shutdown.json.

## Resultado e próxima ação — NÃO executada

Backup SQL, restore da captura, Auth por contagem e Storage bytes/metadata/checksum:
PRONTOS e comprovados. NO-GO para tratar esse arquivo histórico como cópia atual
de produção: a origem ativa mudou desde o dump e o critério de contagens atuais
iguais não foi atingido. Isso NÃO é falha de reconstrução do dump.

Próxima ação: revisar/aceitar explicitamente a diferença temporal (deals atuais 2
versus captura 3) e definir quais dados serão migrados, janela de congelamento e
captura final consistente antes do cutover. Solicitar aprovação própria para
essa captura, que foi proibida nesta retomada. Também planejar configuração
externa Supabase/Auth e preservação segura da ENCRYPTION_KEY para recuperação real.
Nenhuma correção de dados, novo dump, congelamento, criação de infraestrutura
ou DNS/cutover foi executado para contornar as diferenças.

Referências primárias:
[restore Supabase e incompatibilidades](https://supabase.com/docs/guides/self-hosting/restore-from-platform),
[Vault oficial](https://github.com/supabase/vault/tree/v0.3.1),
[pgvector oficial](https://github.com/pgvector/pgvector/tree/v0.8.2),
[libsodium releases oficiais](https://download.libsodium.org/libsodium/releases/),
[pg_dump 17](https://www.postgresql.org/docs/17/app-pgdump.html),
[pg_restore 17](https://www.postgresql.org/docs/17/app-pgrestore.html).
