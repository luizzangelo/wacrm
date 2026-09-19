# ETAPA 21C — topologia B e estado do ensaio

> HISTÓRICO. A topologia B foi SUPERADA pelo ambiente único produtivo 21H.
> Este relatório preserva o estado da etapa 21C; o restore concluído depois
> consta em 21D. Não executar migração/cutover com base neste plano.
> Referência vigente: [produção in-place 21H](production-in-place-21h.md).

Estado: BLOQUEADO antes do dump. Auditoria e decisão de topologia concluídas;
backup/restore REAL não executado. Não existe checksum/arquivo validado nem
evidência de recuperação. Nenhum destino de restore ou produção foi criado.
HEAD de origem da auditoria: `22e013fc8013f263e8293173db45d12d016107af`.

## Decisão formal

O usuário escolheu B — PRODUÇÃO SEPARADA. `crm.luizangelo.com.br`,
`wacrm_staging` e `awganmhowivedfocwzjy` continuam STAGING. Recursos planejados
no [runbook atualizado](production-topology-and-backup.md): domínio sugerido
`app.luizangelo.com.br`, stack `wacrm_production`, projeto Supabase, scheduler,
secrets e roteamento próprios. Nenhum recurso produtivo foi criado; DNS/Meta
não foram alterados. Compartilhar fila/secrets de scheduler é proibido.

## Disco — somente leitura, nenhuma remoção

VPS inicial `df -h /`: total 38G, usado 33G, livre 2.8G, utilização 93%.
Fechamento: total 38G, usado 24G, livre 13G, utilização 65%. Entre as leituras,
o build cache caiu a 0 registros/0 bytes; autor/causa dessa liberação não
determinados. Esta etapa executou SOMENTE auditoria read-only, sem cleanup.
Images/containers/volumes permanecem 32/24/11 e serviços staging saudáveis.

Inventário inicial Docker (não confundir com o estado final):

| Categoria Docker | Total ocupado | Recuperável indicado pela ferramenta |
| --- | --- | --- |
| Images | 7.761 GB; 32 images, 18 ativas | 1.219 GB |
| Build cache | 8.983 GB; 161 registros | 8.983 GB |
| Containers | 273.3 MB; 24, 16 ativos | 197 bytes |
| Volumes | 5.062 GB; 11, 8 ativos | 123.8 MB |

Não somar cegamente images/cache: camadas compartilhadas e dependências podem
reduzir a liberação real. Recuperável NÃO significa seguro apagar: nenhum prune,
image/container/volume delete, journal vacuum ou cleanup foi executado.
Docker recuperável final: images 1.219 GB; volumes 123.8 MB; containers 197 bytes;
build cache 0 bytes. Containers ocupam 274 MB no fechamento. Não houve remoção
de dados ou cleanup executado por este agente nesta etapa.
Journals ativos/arquivados ocupam 3.7G; logs Docker JSON somam 115946925 bytes.
Retenção/liberação de logs depende de aprovação; não classificar tudo como lixo.
`/opt` ocupa cerca de 415 MB, `/opt/wacrm-staging` 18 MB. Nenhum `.dump`, `.backup`
ou `.sql.gz` foi encontrado nos diretórios /opt e /var/backups até profundidade 3;
isso não é uma busca global ou autorização de exclusão.

O banco inteiro tem 16026771 bytes (15 MB); relações de public/auth/storage/ledger
somam 4497408 bytes. Esses números não são o tamanho de um dump ainda inexistente.
Disco final tem folga para ensaio deste dump pequeno, mas não deve ser o único
destino principal. RAM: 3.7 GiB total, 2.5 GiB usada, 1.2 GiB disponível; swap
1.0 GiB de 2.0 GiB usada. Dimensionar recursos/limites e headroom antes de uma
segunda instalação/build produtiva; capacidade global não foi validada por carga.

Mac local: FileVault ON e 52 GiB livres. Preferir destino restrito fora da VPS/Git,
`/Users/luizangelo/.local/share/wacrm-backups`, modo 0700 e arquivos 0600.
Diretório/backup ainda não criados. Não contratar armazenamento pago novo.

## Bloqueio de conexão PostgreSQL

Projeto confirmado pelo MCP e runtime: awganmhowivedfocwzjy, ACTIVE_HEALTHY,
us-east-1, host db.awganmhowivedfocwzjy.supabase.co. SQL server_version = 17.6;
build do provedor 17.6.1.166. Exigir cliente pg_dump/pg_restore major 17 compatível.
Não há cliente pg_dump/psql instalado no PATH local ou host VPS nem nos locais
de instalação verificados; não reutilizamos binários de outros serviços.

Não foram encontradas credenciais PostgreSQL nos lugares em escopo:
.env.local do projeto (nenhum campo DB/PG), ambientes local/runtime staging,
.pgpass/.pg_service.conf do usuário local e root VPS, supabase/.temp do projeto
(somente cli-latest), arquivos de ambiente do deployment staging (public.env e
examples, sem configuração de DB privada). A API key service-role e o MCP
OAuth não são senha PostgreSQL. Não houve tentativa de senha, reset, criação de
cli_login_postgres ou alteração de privilégios no banco ativo.

Retomada exige um libpq service file/password file restrito, configurado pelo
canal seguro autorizado. Perfil wacrm_source apontando exclusivamente ao staging;
credencial fora de argumentos/chat/Git/logs. Fornecer só os caminhos, nunca senha
ou URI secreta. Confirmar Connect/direct IPv6 ou Session pooler 5432 real e TLS.

## Inventário origem para validação futura

Contagens exatas consultadas read-only; NÃO são comparação com um restore.

| Tabela | Origem |
| --- | ---: |
| accounts | 1 |
| profiles | 1 |
| contacts | 3 |
| conversations | 3 |
| messages | 22 |
| whatsapp_config | 1 |
| pipelines | 1 |
| pipeline_stages | 5 |
| deals | 3 |
| deal_loss_events | 1 |
| meta_ad_attributions | 2 |
| meta_conversion_config | 1 |
| meta_conversion_events | 8 |
| auth.users | 1 |
| auth.identities | 1 |
| supabase_migrations.schema_migrations | 47 |

Meta pending/sending = 0/0. Preservar todas as linhas e estados terminais,
event_id, attempts, sent_at; nunca reabrir sent/failed/delivery_unknown.
Para comparação válida durante writes ativos, usar a mesma snapshot read-only
do dump para inventário origem, por conexão PostgreSQL dedicada mantida aberta
com pg_export_snapshot; dados/roles/config fora da snapshot exigem coleta
coordenada. Consultas MCP independentes não provam snapshot do pg_dump.

Origem contém is_lost_stage, lost_reason, lost_reason_notes, meta_attribution_id,
deal_loss_events e trigger create_deal_on_whatsapp_inbound. Triggers de lifecycle,
perda, anti-duplicidade, contexto, outbox e profile privilege estão ativos.
No restore conferir colunas/defaults, enums/checks, índices/uniques, constraints/
FKs, policies/RLS, views, triggers/enabled e funções/owners/search_path/grants.
Não testar chamadas destrutivas nem mover deals para validar essas estruturas.

Hardening está aplicado: Git 20260917161334, ledger 20260917163719; SQL/SHA-256
em [reconciliação](migration-reconciliation.md). Definers anon: is_account_member,
peek_invitation; authenticated: essas duas mais set_member_role,
remove_account_member, transfer_account_ownership, redeem_invitation,
touch_presence. Seis RPCs internas invoker sem browser EXECUTE. Preservar ACLs e
owners; não usar no-acl/no-owner para esconder falha e declarar segurança validada.
Ledger restaurado deve igualar origem (47 registros e SQL), sem reparar timestamps
nem reaplicar equivalências. Banco produtivo NOVO usa 001–042, depois timestamps
Git em ordem, cada SQL uma vez; restauração completa é outro fluxo.

## Cobertura Supabase e limitações

| Componente | Cobertura e recuperação requerida |
| --- | --- |
| PostgreSQL | Custom pg_dump contendo schema/dados necessários; validar TOC, privilégios e cobertura de schemas gerenciados |
| Auth | Incluir auth.users/identities e demais objetos auth preservando UUIDs/hashes, sem disparar signup; SMTP/providers/JWT/redirects ficam fora do dump |
| Storage metadata | Incluir buckets/objects/policies/config necessários no SQL; não contém bytes dos arquivos |
| Storage bytes | Cópia separada protegida, inventário/checksums; não baixados nesta auditoria |
| Edge Functions | Nenhuma existente no projeto, confirmado por list_edge_functions |
| Project settings/secrets | Inventário e cópia cifrada independente; sem valores em Git/chat; não exportados nesta etapa bloqueada |
| Realtime | Publicação supabase_realtime inclui conversations,deals,flow_runs,member_presence,message_reactions,messages,notifications; recriar/validar no destino aprovado, não transportar internals cegamente |
| Extensions | plpgsql 1.0, pgcrypto 1.3, uuid-ossp 1.1, pg_stat_statements 1.11, vector 0.8.2, supabase_vault 0.3.1; imagem destino deve suportá-las |

Vault tem 0 secrets, mas isso não torna sua extensão dispensável num restore
completo. PostgreSQL vanilla não garante compatibilidade; usar PG17 compatível
com as extensões ou registrar exatamente a cobertura parcial sem chamar de PASS
completo. Não fabricar funções ou ignorar erros de extensões/roles.
Chave de criptografia raiz do Vault gerenciada é distinta da ENCRYPTION_KEY do
WACRM; migração manual entre projetos segue procedimento oficial específico.
Realtime gerenciado tem restrições novas: não executar DDL sobre seus internals
no projeto ativo nem pressupor que todo schema seja portável entre projetos.

ENCRYPTION_KEY staging preservável: SIM, Docker Secret existente e disponível no
runtime. Nenhum valor foi impresso/exportado ou token descriptografado nesta etapa.
Recuperação real dos tokens armazenados exige a MESMA chave correspondente ou
recriptografia aprovada; criar nova chave aleatória não recupera esses tokens.
Ainda é necessário guardar cópia cifrada separada junto ao plano de recuperação.

Auth redirect: runtime NEXT_PUBLIC_SITE_URL e callback de recovery usam
https://crm.luizangelo.com.br e /auth/callback → /reset-password. Site URL,
allowlist de redirects e SMTP/providers reais do serviço Auth NÃO foram
confirmados por Management API; acesso/config protegido ainda necessário para
inventário completo. Não inferir allowlist a partir de env ou comportamento passado.
No futuro projeto preservar usuários/identities/UUIDs/hashes e configurar URLs
do domínio aprovado; usuários podem precisar novo login por diferença de signing key.

Leaked password protection: INATIVA segundo advisor atual. Não habilitada.
Antes de produção, em Authentication → configuração de passwords, habilitar
proteção de senhas vazadas após aprovação/confirmar plano Pro ou superior; nenhum
upgrade pago autorizado. Management API oficial pode ser usada com credencial e
aprovação próprias, mas não foi executada. Registrar controle equivalente aprovado
se o recurso não estiver disponível; não chamar configuração atual de PRONTA.

Storage auditado, sem paths/PII ou downloads:

| Bucket | Público | Objetos | Bytes aproximados |
| --- | --- | ---: | ---: |
| avatars | Sim | 1 | 392255 |
| chat-media | Sim | 0 | 0 |
| flow-media | Sim | 0 | 0 |

Estratégia: exportar configurações/policies e inventário protegido de paths,
tamanhos e hashes; copiar o único objeto não vazio para destino restrito quando
o backup puder ser completado, verificar checksum e manter os bytes fora da VPS.
Restauração de objetos vai só ao projeto isolado/aprovado, preservando bucket,
path, content-type/cache-control e políticas, sem chamadas Meta. Não copiar buckets
vazios ou baixar todo conteúdo desnecessariamente. Metadata sozinha é incompleta.

## Drill obrigatório quando houver credencial

1. Confirmar fonte, versionamento/tools17, libpq files 0600, destino seguro e
   espaço. Salvar manifest/inventário consistente no mesmo run restrito.
2. Executar custom pg_dump read-only do staging; exportar roles sem passwords
   pelo mecanismo autorizado. Não tentar elevar privilégio da origem.
3. Registrar filename, bytes, SHA-256 e pg_restore --list; validar todos os objetos
   críticos, Auth/Storage metadata e ledger. Arquivo não vazio não prova cobertura.
4. Se houver streaming VPS → Mac, pipeline precisa detectar erro do pg_dump/SSH;
   checksum dos bytes originais e recebidos deve coincidir. Não chamar EOF parcial
   de sucesso. Não remover origem temporária antes dessa prova (nenhuma criada agora).
5. Criar só laboratório PG17 temporário sem egress, portas públicas, webhook,
   cron/pg_net executáveis, app ou scheduler. Não montar Docker secrets de runtime;
   nunca usar tokens restaurados. Preferir armazenamento temporário dedicado,
   sem conectar volumes de outros serviços ou apagar volumes Docker existentes.
6. Provisionar extensões/roles compatíveis e verificar que DB alvo é laboratório,
   nunca awganmhowivedfocwzjy. Restaurar archive confiável com exit-on-error e
   single-transaction em banco vazio; registrar início/fim/warnings/erros.
7. Comparar contagens da snapshot, dados críticos, schema, FKs/constraints,
   funções/ACLs/RLS, ledger e estados Meta. Consultas read-only de contatos/deals/
   pipelines/losses/events; sem integrações externas.
8. Guardar backup/manifest/checksum fora da VPS, acesso restrito; formalizar aceite
   ou FAIL explícito. Remover somente o laboratório criado para esta execução se
   estiver identificado, não houver dados únicos e remoção for segura/documentada.

Não foi necessário criar laboratório enquanto o dump está bloqueado. Não houve
backup, transferência, pg_restore --list, início/fim de restore, consultas de
validação no restore ou remoção de ambiente. Erros de restore: não aplicável,
pois não executado; não confundir com restore bem-sucedido/sem erros.

## Resultado e retomada

NO-GO para criar produção: credencial PostgreSQL ausente; cliente17/laboratório
compatível a preparar; backup completo/Storage e restore ainda não comprovados;
capacidade da VPS e configuração Auth requerem definição/aprovação.
Nenhuma mutation de negócio/Meta ou cleanup nesta etapa. No fechamento foram
reconsultadas as 13 tabelas críticas: contagens e fingerprints agregados iguais
ao início, novos eventos Meta 0, pending/sending 0/0. As seis RPCs internas
continuam invoker/service-only com search_path fixo. Staging permanece ativo;
app e scheduler seguem 1/1 healthy, zero restarts, ciclos automáticos HTTP200 idle.
Alterações desta etapa são apenas documentação local, sem deploy/push automático.

Próxima ação EXATA: configurar conexão staging em libpq service file e password
file 0600 fora do Git/chat, e informar SOMENTE os caminhos para retomar o ensaio.
Não resetar senha nem criar produção. Se existe credencial em outro arquivo
protegido, informar seu path, não o conteúdo.

Referências primárias:
[backup/restore Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[restore para self-hosted](https://supabase.com/docs/guides/self-hosting/restore-from-platform),
[password security](https://supabase.com/docs/guides/auth/password-security),
[Realtime protegido](https://supabase.com/changelog/realtime-schema-locked-down-against-modification),
[extension version pinning](https://supabase.com/changelog/extension-version-pinning-ignored).
