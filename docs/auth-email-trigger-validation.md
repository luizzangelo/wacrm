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
