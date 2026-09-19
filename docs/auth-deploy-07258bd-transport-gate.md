# Deploy Auth 07258bd — parada no gate de histórico

18/09/2026. Autorização de transporte, migration única e deploy controlado. **Nenhuma alteração de produção foi realizada.** A regra de parar em qualquer erro foi respeitada. A skill Supabase orientou a validação de histórico e privilégios antes de qualquer SQL de escrita.

## Relatório solicitado

1. Precheck VPS: PASS. Linux/amd64, Docker 28.1.1, Swarm ativo; app e scheduler 1/1, healthy, zero restarts. RAM disponível 934 MiB, swap usada 805 MiB, ~11 GiB livres, load 0.06/0.01/0.00. Sem build na VPS.
2. Checksum local: `8de394680e9aea7462707c5935b53907927ad8fb4f07eb55a9bd9f1deccd889e`. Export Docker save linux/amd64, gzip, 80102498 bytes. Artefato privado: `/Users/luizangelo/Backups/wacrm/auth-deploy.Pp42pX/wacrm-07258bd.tar.gz`.
3. Checksum VPS: não calculado; transferência não executada.
4. Integridade do transporte: não aplicável; somente export local concluído.
5. Image ID carregado: não houve load. Imagem local validada: `sha256:1e5cbb7cac91b2d8aa33b589c1131013fb5747a49d4bf04fb27adb0409c7b231`, linux/amd64.
6. Migration aplicada: NÃO. `20260918161120` ausente; ledger remoto continua com 48 entradas. Gate bloqueado antes da migration e antes da transferência.
7. Trigger/function/grants: função nova ausente no pré-check; sem validação pós-aplicação porque não foi aplicada. Nenhuma ACL/RLS/role foi modificada.
8. SHA implantado: imagem atual continua `ed9ebd7`; HEAD local `07258bd2618462111dc78a3065152764ce64263f` não implantado.
9. Imagem anterior: `wacrm-staging:ed9ebd7`, presente e em uso.
10. Imagem nova: `wacrm-staging:07258bd`, disponível apenas no Mac e no export privado.
11. Rolling update: NÃO executado. Manifesto, serviços e scheduler intactos.
12. Smoke Auth: página login checada por HTTP após a parada; testes autenticados, signup/logout e demais fluxos novos não executados. Nenhuma senha/e-mail real alterado. Não há identidade controlada confirmada nesta autorização.
13. CLI administrativa: distribuição e Inspect produtivo NÃO executados; sem novo endpoint/rota pública. Não alegar disponibilidade na imagem standalone, que não empacota scripts operacionais.
14. Multi-tenancy: nenhuma mutation de accounts/profiles/memberships/roles; nova rodada Tenant A/B não executada neste turno, pois a execução parou no gate anterior.
15. WhatsApp: sem envio ou teste de integração; nenhum recurso alterado. Inbound/outbound/status não reexercitados nesta etapa.
16. Meta scheduler: revalidado 1/1, running, healthy, zero restarts, imagem `ed9ebd7` preservada. Nenhum cron manual ou POST /events executado pelo operador. Contadores de execuções automáticas não foram auditados novamente após a parada.
17. Storage: nenhum bucket/objeto/configuração alterado; checks de leitura/signed URLs e gate final de backup não executados nesta retomada.
18. Saúde VPS: app e scheduler revalidados depois da parada: running, healthy, zero restarts, 1/1. Sem prune, instalação, build, resize ou alteração dos outros serviços.
19. Warning bloqueante: comparador estrito `deploy/migration-equivalence.mjs` retornou `BLOCKED_VERSION_SQL_MISMATCH` para as 42 versões históricas `001`–`042`. Todas possuem statements não vazios no ledger. Cinco migrations recentes têm equivalência textual comprovada; a migration nova é a única não registrada. O gate esperava somente uma entrada não equivalente e recebeu 43, interrompendo com `Unexpected pending migrations`. Isso NÃO prova que 42 migrations estejam pendentes ou que o schema esteja incorreto: prova apenas que a equivalência textual exigida não foi estabelecida. Não foi feito repair, reaplicação nem normalização improvisada do histórico.
20. Rollback: imagem anterior verificada, `sha256:77245e16749c6671db1daada46894a0122f90f4bdbeb9355605a223e8a9863f0`; nenhum rollback necessário, pois não houve deploy. Backup anterior preservado: `/Users/luizangelo/Backups/wacrm/production/20260918T163807Z`, mas checksums/deltas ainda precisam ser revalidados antes de mutation futura.

## Limites e confirmações

- Único Supabase consultado: `awganmhowivedfocwzjy`, somente leitura. Shodisparo `zyqbgrrpedzxfcwhlfoa` não tocado.
- Meta, DNS, SMTP/Resend e configuração externa de Auth não alterados. SMTP ausente/password global 6 são contexto anterior, não uma nova auditoria administrativa. `mailer_autoconfirm` não foi alterado.
- WACRM mínimo 8 e suporte administrativo para forgot/change-email continuam na imagem nova ainda NÃO implantada. Não declarar comportamento novo ativo em produção.
- Nenhum password, token, service key, .pgpass, encryption key ou env sensível exibido. `.pgpass` somente teve permissões verificadas; libpq usa o arquivo internamente.
- Artefato de transporte retido no Mac para evitar export redundante numa retomada; nada transportado para VPS. Imagem anterior e backups preservados.
- Próxima etapa necessária: diagnóstico read-only da divergência histórica `001`–`042` e definição de um gate de equivalência fundamentado. Não reinterpretar divergência textual como autorização para reaplicar migrations. Depois revalidar backup e retomar a operação autorizada; nenhuma continuação automática após esta parada.
