# Reconciliação de migrations — 21B

Alvo existente: SOMENTE staging `awganmhowivedfocwzjy`. Histórico antigo não foi
editado nem reaplicado. Não usar `supabase db push --include-all` neste projeto
existente sem reconciliação prévia: timestamps diferentes não provam SQL pendente.

## Equivalências verificadas

Comparação read-only de `supabase_migrations.schema_migrations.statements` com os
arquivos Git. Normalização: CRLF → LF e trim nas extremidades, NADA dentro do SQL.
SHA-256 é checksum de SQL público, não de credenciais/PII.

| Git | Staging | Nome | SHA-256 idêntico |
| --- | --- | --- | --- |
| 20260917035905 | 20260917043852 | deal_initial_stage_and_loss | c27ff77f28d6bdb4e00bb19ada3cdff1460c92e4fea19297125f4cba623a7d67 |
| 20260917051426 | 20260917052243 | inbound_deal_and_card_context | 666d6923f2f7482bbd9e33cc5dc0cb879d6d62507c20acb2f5e76f78332ecc7a |
| 20260917053602 | 20260917053939 | deal_card_reply_indicator | a858faf1c8e98287369ac22b9c34d37e8e1d6a7d22dc8ebec3f9394325013d38 |
| 20260917054725 | 20260917060202 | dashboard_loss_history_and_response_metrics | 2b20cb5aa73d77fb0f7079646c3d622afe87103cb5883b86163316a2b877f915 |

Estas quatro migrations estão APLICADAS por equivalência de SQL. Não executar
novamente, não renomear os arquivos históricos e não fazer `migration repair`
apenas para deixar timestamps visualmente iguais.

A única migration nova desta etapa foi confirmada por comparação integral do SQL
após apply: Git `20260917161334` → staging `20260917163719`,
`security_hardening_privileged_rpcs`; SHA-256 normalizado
`37b50edd73573132c55ba35791f98353034af7beafeddf7db0c5c5fa4081438e`.
O timestamp foi atribuído pelo MCP; não reparar nem reaplicar essa migration.

## Procedimento reproduzível

1. Confirmar project ref, ambiente, HEAD e branch. Obter ledger por SELECT
   `version, name, statements` em `supabase_migrations.schema_migrations`, ordenado
   por version. Exportar SOMENTE essa seleção para JSON restrito (0600), fora do Git.
2. Executar `node deploy/migration-equivalence.mjs supabase/migrations LEDGER_JSON`.
   O script não conecta ao banco, não aplica e não repara histórico.
3. `ALREADY_EQUIVALENT`: não reaplicar; registrar par de versões e checksum.
   `BLOCKED_VERSION_SQL_MISMATCH`: parar. `REVIEW_NOT_PROVEN`: inspeção manual,
   não é autorização automática para aplicar. Statements ausentes, SQL separado
   de forma diferente ou ausência de ledger não provam que uma migration falta.
4. Aplicar somente migrations realmente novas, uma vez, depois dos testes
   isolados e da revisão. Reconsultar ledger e comparar SQL completo/checksum.
   O MCP pode registrar timestamp próprio: documentar o novo par, sem reparar.
5. Eventual reparo exigido por uma futura ferramenta oficial requer snapshot do
   ledger, diff explícito, aprovação e prova de equivalência; nunca executar DDL
   repetido como substituto de reparo de metadados.

## Banco novo, se futuramente autorizado

Usar a ordem oficial dos arquivos Git: `001` até `042`, depois os timestamps em
ordem lexical. Migrations legadas usam versões curtas; não rebatizar silenciosamente
para satisfazer parser de CLI. Validar o mecanismo de replay em banco descartável,
registrar cada versão uma vez e aplicar o hardening por último. Em projeto Supabase
novo respeitar os schemas/roles gerenciados e bootstrap de Auth/Storage. Não
transportar apenas o ledger do staging para um banco vazio sem executar o SQL.
Restauração de banco completo é outro fluxo: preservar ledger restaurado e só
aplicar diferenças comprovadas. Nenhuma produção ou replay completo foi criado aqui.
