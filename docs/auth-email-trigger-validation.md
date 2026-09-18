# Validação read-only do trigger Auth

O check que interrompeu a execução de 18/09/2026 estava no helper privado
`final-deploy.mjs`, linha 84: `security.trigger.includes(...)`. O helper de
escrita anterior não deve ser reexecutado: a migration já está registrada.
Este tooling versionado substitui aquele check, sem mudar o comparador de
migrations, a migration, a aplicação ou o banco.

`deploy/auth-email-sync-validation.mjs` exporta somente SQL de inspeção SELECT
e validadores sem I/O. Consultar com uma conexão read-only aprovada e passar
o resultado de `AUTH_EMAIL_TRIGGER_SQL` a `validateAuthEmailTrigger`.

Os campos de catálogo verificam nome/tabela/função, bitmask 17 (AFTER UPDATE
FOR EACH ROW), coluna email, enabled=O, zero argumentos e ausência de referências
de transition tables/constraint. Exige uma única ocorrência do nome em todas as
tabelas. A definição decompilada também precisa concordar com essa estrutura.

Somente a condição exata `old.email IS DISTINCT FROM new.email` é aceita:
parênteses de agrupamento, whitespace e casts `::text`/`::pg_catalog.text` nos
dois operandos são representações admitidas. O tipo de email precisa ser text
ou varchar, permitindo provar esses casts; citext e outros tipos falham.
Não remove casts indiscriminadamente, comentários, funções, outros operadores,
colunas, cláusulas OR/AND ou SQL adicional. Diferença desconhecida falha fechada.

Referência de estrutura: [catálogo pg_trigger PostgreSQL 17](https://www.postgresql.org/docs/17/catalog-pg-trigger.html).

Teste específico: `node --test deploy/auth-email-sync-validation.test.mjs`.
Não contém execução de migration, db push, repair nem escrita de ledger.

## Serialização OID

`normalizeOid` aceita números inteiros e strings decimais no intervalo unsigned
32-bit PostgreSQL (0–4294967295), retornando string decimal canônica. null e
undefined permanecem inalterados, mas não satisfazem a expectativa de zero do
trigger. Valores inválidos/negativos/fracionários/overflow falham; sem coerção
frouxa. Zeros decimais à esquerda são normalizados somente nesse campo.

Auditoria da mesma query: somente `constraint_oid` contém OID no JSON retornado
e é normalizado. OIDs de trigger/relação/função são usados internamente nos JOINs
e não retornados. tgtype, pronargs e tgnargs são smallint, não OID, e continuam
validados estritamente como números. A expectativa continua constraint_oid=0:
um OID não zero não passa por ter sido normalizado.
