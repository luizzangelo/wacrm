# Rollout Auth 07258bd — relatório final

Execução iniciada em 18/09/2026 e saúde final coletada em
19/09/2026 04:25:13 UTC. Autorização:
`23daa611-89cb-46ed-b3fa-5c74ebe8b2bc/pasted-text.txt`.

O app foi implantado e estabilizou. O gate final read-only passou. A execução
parou durante o smoke de signup controlado: a única requisição foi rejeitada,
o harness falhou fechado sem preservar o HTTP/mensagem e não houve retry. A
leitura posterior provou que nenhum usuário, profile ou account sintético foi
criado e que todos os fingerprints anteriores ficaram intactos. Não foi feita
correção improvisada em produção.

## Relatório solicitado

1. **Causa number/string:** `pg_catalog.oid` é unsigned 32-bit; a serialização
   JSON da consulta devolveu `tgconstraint` como `"0"`, enquanto a fixture
   usava `0`. Era diferença de representação local, não do trigger.
2. **Estratégia OID:** `normalizeOid` aceita somente number inteiro ou string
   decimal entre 0 e 4294967295, devolvendo string decimal canônica. null e
   undefined permanecem distintos; valores inválidos falham fechados, sem `==`.
3. **Campo normalizado:** somente `constraint_oid`. OIDs de trigger/relação/
   função não saem da query; são usados em JOINs. tgtype/pronargs/tgnargs são
   smallint e continuam números estritos. Constraint não zero continua falhando.
4. **Testes adicionados:** zero e OID positivo number/string, iguais/diferentes,
   null, undefined, inválidos, overflow, negativos, fração, valores compostos,
   preservação do input, retorno real com `"0"`+`::text`, constraint não zero e
   garantia de que os outros campos numéricos não são convertidos.
5. **Total:** validator 69 testes; regressão Node combinada 191 testes; Vitest
   125 arquivos/1484 testes; PostgreSQL nativo 139 observações e concorrência
   três cenários.
6. **Resultados:** todos os testes acima PASS; syntax, lint focal, typecheck e
   diff-check PASS. Laboratório rollback intacto, clone removido, zero integração.
7. **Commit da correção:**
   `555fcf5aedfbfc8e58e670997b9d182ae8f796f4`, enviado para `origin/main`.
8. **Gate pré-rollout:** 49 ALREADY_EQUIVALENT / 0 PENDING /
   0 MATERIAL_MISMATCH / 0 UNKNOWN. Backup
   `/Users/luizangelo/Backups/wacrm/production/20260918T210943Z`: 10 checksums
   verificados, dump SHA-256
   `b56c5604dd56cf04203ac1a6c68418dd7c7bd83cd94b7eac530a362eeb327bda`;
   Storage estável, zero delta posterior antes do rollout.
9. **Trigger/function:** validator PASS com o catálogo real. Trigger único,
   auth.users, AFTER UPDATE OF email/FOR EACH ROW, enabled, função privada
   correta, condição old.email IS DISTINCT FROM new.email. Corpo idêntico à
   fonte, SECURITY DEFINER, owner postgres, search_path pg_catalog/pg_temp,
   anon/authenticated/service_role/PUBLIC sem EXECUTE, anon sem schema USAGE,
   FK correta e drift Auth/profile=0. Skill Supabase guiou destino, privilégios,
   fail-closed e validação read-only.
10. **Diff `07258bd..HEAD`:** somente deploy tooling, testes e documentação:
    validator OID/trigger, comparador de migrations e respectivos testes/runbooks.
    Nenhum src/runtime, dependência, Dockerfile ou migration; imagem não rebuildada.
11. **Precheck:** amd64, Swarm active, app/scheduler 1/1 healthy, zero restart/
    OOM, `/login` HTTP 200; imagem nova e rollback presentes; backup validado.
    Antes do update: RAM disponível 908 MiB, swap 803 MiB, load 0.04/0.03/0.04,
    10 GiB livres.
12. **Imagem anterior:** `wacrm-staging:ed9ebd7`, ID
    `sha256:77245e16749c6671db1daada46894a0122f90f4bdbeb9355605a223e8a9863f0`,
    preservada e disponível.
13. **Imagem implantada:** app em `wacrm-staging:07258bd`, ID clássico da VPS
    `sha256:65d7dc1ee2a57d16eb8bd9c4e5a542f32059f611658889e2b8c2522801b1901c`,
    linux/amd64. Transporte e nove camadas RootFS já tinham igualdade comprovada.
14. **Rolling update:** somente `wacrm_staging_app`, stop-first, 1/1, update
    completed, nova task healthy, restarts=0/OOM=false. TaskTemplate inteiro,
    UpdateConfig e Service ID permaneceram iguais fora da imagem. Scheduler
    ficou intacto em ed9ebd7. O stack.yml remoto não foi editado nesta execução;
    um futuro redeploy do manifesto precisa preservar explicitamente 07258bd.
15. **Smoke Auth:** páginas login/signup/forgot/reset HTTP 200; forgot/reset
    exibem suporte e não têm formulário de recovery. POST de senha: sete rejeita,
    oito ultrapassa a política e exige senha atual; recovery retorna 403 antes do
    provider; signup com sete rejeita localmente. CLI Inspect no usuário real,
    autorizada pelo usuário, PASS e nenhuma alteração. Signup/login/logout
    sintéticos NÃO homologados: único POST de signup com senha forte foi rejeitado;
    harness registrou a fase, mas perdeu HTTP/mensagem na assertion. Sem retry.
    Read-only posterior: 0 synthetic Auth/profile/account; nenhuma credencial de
    fixture salva; fingerprints e contagens Auth permaneceram 1/1. Logo não
    alegar signup/login/logout ponta a ponta.
16. **CLI:** `npm run admin:auth-user`, modo 3 Inspect real, PASS; e-mail/UUID
    mascarados no registro do agente, senha/e-mail intactos. Projeto errado e
    transportes perigosos cobertos por 19 testes. Sem endpoint/rota web/API.
    A imagem standalone não contém scripts nem o pacote SDK resolvível para a
    CLI; ela foi executada no ambiente Node privado do Mac já autorizado. Nenhum
    pacote foi instalado na VPS. Distribuição server-side VPS continua pendente.
17. **Regressões:** Tenant A/B e invariância no PG17 PASS; membership é profiles,
    não account_members. Produção read-only: contacts=3, conversations=3,
    messages=22, deals=2, pipelines=1, attributions=2, Meta events=8,
    notifications=0; 40 tabelas public com RLS, zero constraint/índice inválido.
    WhatsApp config=1/connected. Nenhum envio WhatsApp ou teste de conteúdo real.
18. **Gate final:** 49/0/0/0, trigger validator PASS, drift=0, function/grants
    PASS, migrations=49, Meta pending=0/sending=0. Migration não reaplicada.
19. **Saúde final (04:25:13Z):** app 1/1 07258bd, scheduler 1/1 ed9ebd7,
    ambos healthy/restarts=0/OOM=false, update completed, `/login` 200. RAM
    disponível 939 MiB, swap usada 800 MiB, load 0.03/0.03/0.04, 11 GiB livres.
    Scanner: 5 linhas/147 bytes nos logs, zero match de PII/secrets/ctwa_clid,
    Bearer, URI com password ou body bruto. Auth público: mailer_autoconfirm=true.
    Storage autenticado HTTP 200, objeto 392255 bytes/checksum preservado;
    acesso anônimo normal e com nonce HTTP 400. Transporte não limpo após a
    parada do smoke; backups e ambas imagens preservados; nenhum prune.
20. **Commits desta execução:** `555fcf5` — normalização OID, testes e documentação,
    com push confirmado. Este relatório é documentação independente e recebe
    commit/push próprio; seu SHA é informado na entrega final.

## Confirmações de escopo

- 20260918161120 NÃO foi reaplicada; históricas não reaplicadas; sem repair,
  db push ou alteração manual do ledger. Migration permanece com SHA-256
  `4c0610517e069ca9d3a0594d9afad62d0257d85040ba66973afe1f6bfe2aaf44`.
- Único Supabase usado foi WACRM `awganmhowivedfocwzjy`. Nenhuma SQL/manual ou
  migration foi escrita nesta execução; o único signup de smoke não criou Auth
  user, profile ou account (uma auditoria interna do Auth pode registrar a tentativa). Shodisparo
  não tocado; Meta, DNS e SMTP não alterados; nenhum cron manual/POST events.
- mailer_autoconfirm não alterado. SMTP ausente e global password_min_length=6
  permanecem contexto administrativo anterior, não nova leitura Management API.
  WACRM implantado exige mínimo 8 e mantém recovery/change-email administrativo.
- Nenhum cliente real teve senha/e-mail alterado; usuário real somente Inspect.
  Nenhum segredo exibido. Alterações concluídas receberam commit e push próprios.
- Último estado saudável: app implantado e operacional. Gate que encerrou o
  fluxo: signup controlado não homologado; nenhum dado sintético foi criado.
  Não repetir antes de instrumentar um harness que preserve HTTP/mensagem e
  revisar, fora de produção, se o domínio reservado usado no fixture foi recusado.
