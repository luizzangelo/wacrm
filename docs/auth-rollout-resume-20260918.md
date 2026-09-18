# Retomada Auth — parada read-only por serialização OID

18/09/2026. Autorização `44d37437-e519-4043-816b-8ad912757770`.
**Rollout não executado; nenhuma escrita no banco neste turno.** Migration
20260918161120 permanece aplicada da execução anterior e NÃO foi reaplicada.

## Relatório solicitado

1. Check corrigido: a comparação `security.trigger.includes(...)` no antigo
   helper privado `final-deploy.mjs:84` foi substituída operacionalmente pelo
   tooling versionado `deploy/auth-email-sync-validation.mjs`. Não invocar o
   helper anterior de escrita. Novo tooling exporta somente SELECT e validação
   pura, sem I/O ou comandos de migration.
2. Normalização: grammar restrita da condição WHEN; aceita parênteses e casts
   text/pg_catalog.text somente nos operandos old.email/new.email e somente
   quando email é text/varchar. Não remove casts arbitrariamente. Catálogo
   verifica nome, tabela, função, tipo/timing/evento/row, colunas, enabled,
   argumentos e ausência de transition tables/constraint.
3. Testes: 38, incluindo sem/com ::text, resultado equivalente, divergências de
   função/tabela/schema/evento/timing/nome/condição/coluna/casts, SQL adicional,
   disabled/replica/internal, duplicidade e argumentos.
4. Testes específicos: 38/38 PASS; lint dos dois módulos PASS; diff --check PASS.
   **Gate produtivo NÃO passou:** minha fixture representou constraint_oid como
   número 0; PostgreSQL serializa esse tipo OID no JSON como string "0". A
   validação estrita rejeitou `'0' !== 0` antes de chegar ao WHEN. Trata-se de
   outro erro local de representação, não de uma mudança no trigger. Não houve
   correção desse segundo erro após a parada exigida.
5. SHA anterior: `0b591dbbe63198298f4e848aa91513448efa1efa`.
6. Commit da correção: `d589f128cd46fdeacef3a6a54fc66c7ba7f3887e`,
   `fix(deploy): validate postgres auth trigger structurally`; somente validator,
   testes e `docs/auth-email-trigger-validation.md`. Criado ANTES dos gates
   produtivos, conforme regra. Este relatório é uma alteração documental
   independente e recebe commit próprio.
7. Migration NÃO modificada: SHA-256 permanece
   `4c0610517e069ca9d3a0594d9afad62d0257d85040ba66973afe1f6bfe2aaf44`.
   Diff 07258bd..HEAD somente deploy tooling/tests/docs; imagem não rebuildada.
8. Gate migrations antes do rollout: 49 ALREADY_EQUIVALENT / 0 PENDING /
   0 MATERIAL_MISMATCH / 0 UNKNOWN, reconfirmado às 21:20:14.924Z.
9. Trigger/function: catálogo lido, único trigger correto em auth.users,
   tgtype=17, enabled=O, coluna email, função privada correta, sem argumentos,
   condição decompilada com ::text. Corpo da função idêntico à fonte;
   SECURITY DEFINER, search_path pg_catalog,pg_temp; anon/authenticated/
   service_role sem EXECUTE. Drift=0. Profiles/accounts/eventos/Auth/RLS/policies
   iguais aos fingerprints anteriores. **Validator automático pendente**, pela
   serialização constraint_oid descrita no item 4; não declarar PASS completo.
10. Imagem anterior: ed9ebd7 em uso e disponível, ID
    `sha256:77245e16749c6671db1daada46894a0122f90f4bdbeb9355605a223e8a9863f0`.
11. Imagem nova: 07258bd carregada, linux/amd64, 231155910 bytes, ID
    `sha256:65d7dc1ee2a57d16eb8bd9c4e5a542f32059f611658889e2b8c2522801b1901c`.
    Integridade do transporte e nove camadas idênticas já validadas no turno
    anterior; presença/ID/plataforma rechecados agora. Não implantada.
12. Rolling update: NÃO EXECUTADO. Nenhuma alteração de serviço, scheduler ou
    manifesto remoto; rollback não necessário, app nunca saiu de ed9ebd7.
13. Smoke Auth: /login HTTP 200. Login/logout/signup e smokes do runtime novo
    NÃO executados, por parada anterior ao rollout. Nenhum usuário real usado
    para testar senha/email. Testes locais anteriores não substituem smoke real.
14. CLI: distribuição/Inspect NÃO executados neste turno. Não há novo endpoint
    público; disponibilidade server-side continua pendente. Não presumir scripts
    administrativos incluídos no runner standalone.
15. Multi-tenancy: fingerprints profiles/accounts/RLS/policies preservados.
    Novos testes Tenant A/B não executados neste turno; resultados anteriores
    PG17/Vitest estão no relatório anterior. Membership usa profiles, não uma
    tabela account_members.
16. WhatsApp: nenhum envio ou novo teste de inbound/outbound/status. Sem mudança
    no runtime; preservação funcional anterior, não nova homologação ponta a ponta.
17. Meta: eventos/fila idênticos ao baseline (events=8, pending=0, sending=0).
    Nenhum cron manual/POST events/alteração de Meta. Scheduler não atualizado.
18. Storage/backup: nenhum recurso alterado. Backup aprovado anterior preservado
    em `/Users/luizangelo/Backups/wacrm/production/20260918T210943Z`;
    dump SHA-256 `b56c5604dd56cf04203ac1a6c68418dd7c7bd83cd94b7eac530a362eeb327bda`.
    Revalidação de manifesto/deltas desta retomada não chegou a executar, pois
    o gate do trigger parou antes. Não foi gerado backup redundante.
19. Gate pós-rollout: NÃO APLICÁVEL, rollout não executado. Última leitura após
    a parada confirma 49 equivalentes / 0 pendentes / 0 mismatch / 0 unknown.
20. Saúde: às 21:19:31 UTC app/scheduler 1/1, healthy, restarts=0, OOM=false,
    ambos ed9ebd7; Docker Swarm active; /login HTTP 200. RAM disponível 911 MiB,
    swap usada 803 MiB, load 0.01/0.04/0.07, disco livre 10 GiB (73% usado).
    Logs recentes finais não coletados nesta retomada; não alegar scanner novo.
    Ambas imagens, backups e transporte mantidos; sem prune/limpeza pós-sucesso.

## Escopo e próxima ação

Nenhuma migration, SQL de escrita, INSERT/UPDATE de ledger, repair, db push ou
reaplicação histórica. Somente WACRM awganmhowivedfocwzjy consultado; Shodisparo,
Meta e DNS não tocados. Migração anterior continua a única escrita autorizada
nesse Supabase, em turno anterior. Nenhuma configuração Auth/SMTP alterada.
SMTP próprio ausente/global mínimo 6 permanecem contexto administrativo anterior,
não nova leitura Management API; mailer_autoconfirm não alterado. Mínimo WACRM 8
permanece na imagem nova ainda não implantada. CLI não exposta; nenhum cliente
real teve senha/email alterados para teste; nenhum segredo exibido.

Próxima ação: autorização para corrigir SOMENTE a serialização do campo OID
local, preferencialmente selecionando `t.tgconstraint::integer` no SELECT de
catálogo (conversão tipada, não relaxamento arbitrário), incluindo teste com
representação real do catálogo, commit próprio e retomada dos gates read-only.
Não reaplicar a migration. Corrigir antes de executar qualquer rollout.
