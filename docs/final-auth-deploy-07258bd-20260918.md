# Deploy final Auth WACRM — parada após migration, antes do rollout

18/09/2026, validação final de saúde às 21:12:59 UTC. Autorização: arquivo
`773b752d-82d3-40f2-a6a0-173394c1b875/pasted-text.txt`. Fonte da aplicação:
`07258bd2618462111dc78a3065152764ce64263f`; comparador homologado/HEAD:
`0b591dbbe63198298f4e848aa91513448efa1efa`. Não foi criado commit neste turno.

**Deploy do app NÃO executado. A migration única FOI aplicada e commitada.**
O processo parou na fase 8 porque meu check adicional usou uma comparação textual
demasiado específica de `pg_get_triggerdef`. Não houve falha SQL ou alteração
inesperada de dados. A regra de parar em qualquer falha de gate foi respeitada:
nenhum ajuste do check, reaplicação da migration ou atualização do app foi feito
após a falha. Consultas subsequentes foram somente leitura para diagnóstico.

## Relatório solicitado

1. Typecheck limpo: PASS. `.next` é ignorada e sem arquivos versionados. A
   primeira movimentação recuperável para Backups ficou bloqueada no syscall
   `rename` do macOS e foi interrompida sem mudar a origem. A movimentação local
   subsequente funcionou: cache preservado fora do repositório em
   `/Users/luizangelo/Documents/wacrm/generated-next-cache-20260918T2112Z`.
   `next typegen` regenerou normalmente; `npm run typecheck` passou. Não houve
   edição manual dos artefatos ou remoção de node_modules.
2. Lint: PASS, 0 erros e 40 warnings legados. Nenhuma correção de código fonte
   foi feita.
3. Build Next local: PASS, compilação/TypeScript e 60 páginas estáticas. Avisos
   existentes de lockfile externo, middleware/Edge deprecados. Não foi rebuildada
   a imagem Docker nem feito build na VPS.
4. Diff `07258bd..0b591db`: somente `deploy/migration-equivalence.mjs`,
   `deploy/migration-equivalence.test.mjs` e `docs/migration-equivalence-gate.md`.
   Nenhuma mudança de runtime, dependência ou migration entre esses commits.
5. Precheck VPS: amd64, Docker 28.1.1, Swarm active, app/scheduler 1/1 healthy,
   restarts=0, OOM=false, imagem anterior ed9ebd7. `/login` HTTP 200; 11 GiB
   livres, RAM disponível 931 MiB, swap usada 805 MiB, load 0.37/0.17/0.11.
6. Backup: os 10 checksums do anterior `20260918T163807Z` passaram e a consulta
   em lote de created_at/updated_at/last_sign_in_at não encontrou deltas após
   16:39:19Z. Timestamps não excluem deleções; por isso foi feita nova captura
   externa em `/Users/luizangelo/Backups/wacrm/production/20260918T210943Z`,
   concluída 21:10:41.480Z. Dump custom: 909870 bytes,
   SHA-256 `b56c5604dd56cf04203ac1a6c68418dd7c7bd83cd94b7eac530a362eeb327bda`.
   TOC/schema offline e manifesto SHA-256 validados antes da escrita. Storage:
   3 buckets privados, 1 objeto, 392255 bytes, bytes separados/inventário estável
   e checksum preservado. Auth users/identities: apenas contagens, 1/1.
   Snapshot DB e captura Storage separados, sem freeze/atomicidade cross-service;
   o novo dump não foi restaurado neste turno. Artefatos privados/sensíveis.
7. Checksum local do transporte:
   `8de394680e9aea7462707c5935b53907927ad8fb4f07eb55a9bd9f1deccd889e`,
   80102498 bytes. Reutilizado exatamente o export linux/amd64 anterior em
   `/Users/luizangelo/Backups/wacrm/auth-deploy.Pp42pX/wacrm-07258bd.tar.gz`.
8. Checksum remoto: igual ao local. Arquivo privado em
   `/opt/wacrm-staging/transfers/auth-07258bd-20260918T2112Z/wacrm-07258bd.tar.gz`.
9. Image ID carregado:
   `sha256:65d7dc1ee2a57d16eb8bd9c4e5a542f32059f611658889e2b8c2522801b1901c`,
   linux/amd64, 231155910 bytes no Docker clássico da VPS. O Mac usa índice OCI
   `sha256:1e5cbb7cac91b2d8aa33b589c1131013fb5747a49d4bf04fb27adb0409c7b231`
   e contabiliza 329661781 bytes. Mesmo config digest previamente validado e
   nove camadas RootFS idênticas, comparadas diretamente; transporte idêntico.
10. Gate imediatamente antes da escrita: 48 ALREADY_EQUIVALENT, 1 PENDING,
    0 MATERIAL_MISMATCH, 0 UNKNOWN. Única pendente autorizada. Versão/função/
    trigger ausentes; drift Auth/profile=0. Fonte da migration SHA-256
    `4c0610517e069ca9d3a0594d9afad62d0257d85040ba66973afe1f6bfe2aaf44`.
11. Migration aplicada: somente
    `20260918161120_sync_auth_email_to_profile.sql`, ao projeto
    `awganmhowivedfocwzjy`, com advisory lock, checks de ausência, SQL e nova
    entrada normal no ledger na mesma transação. COMMIT concluído, sem retry.
12. Gate depois: 49 ALREADY_EQUIVALENT, 0 PENDING, 0 MATERIAL_MISMATCH,
    0 UNKNOWN. Ledger histórico preservado por fingerprint, sem repair.
13. Função/trigger/grants: corpo da função idêntico à fonte; SECURITY DEFINER,
    owner postgres, search_path `pg_catalog, pg_temp`; sem EXECUTE para PUBLIC,
    anon, authenticated e service_role; anon sem USAGE no schema privado. FK
    profiles.user_id → auth.users.id existente. Trigger habilitado, tgtype=17
    (AFTER UPDATE, FOR EACH ROW), tgattr=5, coluna email attnum=5. Profiles,
    accounts, eventos Meta, RLS/policies e contagens Auth permaneceram idênticos;
    drift=0. Não criou perfil nem mudou memberships/roles/email real.
    **Check textual falhou:** esperava `WHEN ((old.email IS DISTINCT FROM
    new.email))`; PostgreSQL decompilou `WHEN (((old.email)::text IS DISTINCT
    FROM (new.email)::text))`. Os casts inseridos na representação foram a causa
    da rejeição do check, não uma divergência da migration. Skill Supabase
    orientou validações de destino, atomicidade, privilégios e Advisors após DDL.
14. Imagem anterior: `wacrm-staging:ed9ebd7` continua disponível e em uso,
    ID `sha256:77245e16749c6671db1daada46894a0122f90f4bdbeb9355605a223e8a9863f0`.
15. Imagem implantada: produção continua em `wacrm-staging:ed9ebd7`.
    `wacrm-staging:07258bd` está carregada, mas NÃO implantada. Nenhum manifesto
    remoto de stack foi editado.
16. Rolling update: NÃO EXECUTADO devido à parada na fase 8. Não foi necessário
    rollback do app; ele nunca saiu da imagem anterior. A migration aditiva
    permanece aplicada, sem tentativa de desfazê-la.
17. Smoke Auth: `/login` HTTP 200; Auth settings GET 200,
    mailer_autoconfirm=true e disable_signup=false. Smokes autenticados do novo
    app/login/logout/signup não executados; nenhuma identidade controlada foi
    confirmada. Não usar o único usuário real como fixture. Novo mínimo 8,
    forgot/reset e change email em suporte estão na imagem não implantada,
    cobertos pelos testes locais; não declarar esses comportamentos ativos no
    domínio sem o rollout.
18. CLI administrativa: 19 testes locais PASS dentro da suíte Node. Guard de
    projeto errado, transporte sem retry, TTY e sanitização cobertos. Distribuição
    privada server-side/Inspect NÃO executados, por parada anterior. Runner não
    empacota scripts, portanto não alegar npm command disponível em produção.
    Não existe novo endpoint/API pública nem alteração de senha/email real.
19. Regressões: Vitest 125 arquivos/1484 testes PASS; Node gate/scheduler/checker/
    CLI 122 PASS; PostgreSQL 17 isolado 139 observações PASS e concorrência 3
    cenários PASS, rollback/fingerprints intactos, laboratório parado e clone
    exclusivo removido pelo harness. Membership é profiles, não account_members.
    Read-only produtivo: contacts=3, conversations=3, messages=22, deals=2,
    pipelines=1, attributions=2, conversion_events=8, notifications=0;
    40 tabelas public com RLS, zero constraints/índices inválidos. Fila continua
    pending=0/sending=0 e eventos históricos idênticos. Nenhum envio WhatsApp,
    POST /events ou cron manual do operador. Scheduler preservado; leituras dos
    logs registradas separadamente: cinco execuções de 21:04:11Z a 21:12:11Z,
    intervalo 120000ms, HTTP 200, processed/sent/failed/delivery_unknown/errors=0.
    Regressão funcional pós-rollout não ocorreu.
    Advisors somente lidos: avisos prévios de vector/public, RPCs intencionais,
    fila sem policies e leaked password protection desabilitada; não corrigidos
    fora do escopo. Referências:
    [RPC anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
    [RPC authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
    [vector/public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public),
    [fila RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
    [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
20. Saúde final: app/scheduler 1/1, healthy, restarts=0, OOM=false, ambos ed9ebd7;
    `/login` HTTP 200. RAM disponível 876 MiB, swap usada 803 MiB, load
    0.05/0.10/0.09; disco 38 GiB total, 26 GiB usado, 10 GiB livre, 73%.
    Scanner pré-migration dos últimos 30min do app retornou 0 linhas, zero matches
    de secrets/PII/ctwa_clid; isso não prova ausência de erros fora da janela.
    Backups, ambas as imagens e arquivos de transporte preservados; limpeza
    pós-sucesso não executada porque o rollout não terminou. Nenhum prune global.

## Confirmações de escopo e próxima ação

- Somente o Supabase WACRM `awganmhowivedfocwzjy` foi alterado. Shodisparo
  `zyqbgrrpedzxfcwhlfoa`, Meta e DNS não tocados. Sem produção nova/freeze/cutover.
- Somente 20260918161120 aplicada; históricas não reaplicadas, nenhum migration
  repair ou db push usado, timestamps históricos intactos.
- App e scheduler 1/1; rollback ed9ebd7 disponível. Produção **ainda NÃO está
  em 07258bd**; scheduler deliberadamente não foi atualizado.
- SMTP/config Auth não alterados; mailer_autoconfirm=true reconfirmado. SMTP
  próprio ausente e password_min_length global=6 são contexto administrativo
  anterior, não uma nova leitura de Management API neste turno.
- WACRM mínimo 8/forgot/change email administrativo presentes na imagem nova;
  rollout pendente, sem alegação de ativação no domínio.
- CLI não publicamente exposta; nenhum cliente real teve senha/email alterado
  para testes. Nenhum segredo exibido; .pgpass não lido/reproduzido pelo agente.
- Próxima ação exige retomada explícita: corrigir **somente a validação local**
  do trigger para verificar catálogo/condição em vez de string sem casts,
  testar esse check e revalidar gate/backup/saúde. Não reaplicar a migration:
  já são 49 equivalentes e zero pendentes. Só então retomar app-only rollout
  autorizado e verificações restantes com usuário controlado.
