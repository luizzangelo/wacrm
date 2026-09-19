# Etapa 21H — produção separada / topologia B

> SUPERADO pela decisão posterior de PRODUÇÃO IN-PLACE em 2026-09-18.
> Documento histórico, NÃO executar seu plano de provisionamento/cutover.
> A organização é Shodisparo (`tpweqctwwkzaajmvrqne`); `wacrm` é o projeto
> `awganmhowivedfocwzjy`, não uma organização. A confusão registrada abaixo foi
> corrigida pelo usuário. O projeto Shodisparo `zyqbgrrpedzxfcwhlfoa` segue fora
> de escopo. Nenhum segundo projeto, organização, upgrade ou stack é necessário.
> Estado vigente e gate de segurança: [produção in-place 21H](production-in-place-21h.md).

Estado: BLOQUEADA antes do provisionamento. Última coleta: 2026-09-18 04:39:35 UTC.
Este documento é um relatório parcial, não um aceite de infraestrutura pronta.

## Organização e autorização

O usuário determinou explicitamente a organização **wacrm**, e rejeitou usar
Shodisparo. Essa decisão prevalece sobre a organização que o conector mostra.
list_organizations retornou somente Shodisparo (tpweqctwwkzaajmvrqne).
O CLI Supabase 2.117.0, após descoberta via --help, não conseguiu listar organizações:
"Access token not provided". Nenhuma credencial foi lida ou exibida.

Não inferir que o projeto staging chamado wacrm seja uma organização chamada wacrm.
Não usar a organização rejeitada, renomeá-la, transferir projetos ou criar uma nova
organização silenciosamente. A organização desejada precisa estar acessível nesta
conexão. Custo e plano de wacrm permanecem DESCONHECIDOS.
Não chamar confirm_cost/create_project antes de obter o custo real e, se adicional,
aprovação explícita do usuário. Nenhuma dessas operações foi executada.

## Capacidade da VPS — somente leitura

- RAM: total 4004438016 bytes (3,73 GiB); usada 2584186880 bytes (2,41 GiB);
  disponível 1420251136 bytes (1,32 GiB).
- Swap: total 2147479552 bytes (2,00 GiB); usada 1113784320 bytes (1,04 GiB).
- 3 vCPUs; load 0,00 / 0,05 / 0,11.
- Disco /: total 39990112256 bytes; usado 27357073408 bytes;
  disponível 10957193216 bytes (10,20 GiB); 72% utilizado.
- PSI memória: some/full avg10=0,00 e avg60=0,00. Amostra anterior vmstat de 8s
  não mostrou swap-out contínuo; swap usado sozinho não comprova thrashing.
- Staging app 1/1 e scheduler 1/1, imagem wacrm-staging:ed9ebd7.

Inventário Docker: 16 serviços ativos. Além do WACRM: n8n editor/webhook/worker,
Evolution v2/Go e seu Postgres, Nextcloud/DB/Redis, Postgres, Redis, Traefik e
Portainer/agent. Nenhum serviço desses foi alterado.
Coleta aproximada anterior (04:36 UTC): n8n editor 321 MiB, worker 310,3 MiB,
webhook 66,43 MiB; Postgres 140,5 MiB; Evolution v2 109,2 MiB; Redis 98,19 MiB;
staging app 66,54 MiB e scheduler 19,26 MiB; demais containers cerca de 3–48 MiB.

Staging app tem limite 768 MiB e reserva 256 MiB. Acrescentar outro app com limite
768 MiB deixaria aproximadamente 586 MiB de RAM disponível antes do crescimento
dos demais serviços. Os limites dos três n8n somam 3 GiB; existem serviços sem
limite explícito. Idle não prova capacidade de pico. O gate de coexistência não
está aprovado: precisa de orçamento de memória/build explícito antes de serviços.
Não houve cleanup, prune, exclusão de imagens/volumes nem resize.

## Integrações externas — BLOCKER

O código aprovado ed9ebd7 não possui kill switch central de runtime que impeça
WhatsApp outbound, CAPI, automações externas e side effects do webhook.
Há controles por tenant/config, mas não substituem um bloqueio de pré-cutover.
Os transportes fazem fetch: src/lib/whatsapp/meta-api.ts,
src/lib/meta-conversions/conversions-api.ts e send_webhook em
src/lib/automations/engine.ts. O webhook pode despachar flows/automações/AI/enrichment.

Banco vazio e scheduler replicas=0 são necessários, mas não comprovam bloqueio
de todas as chamadas externas. Não implementar uma variável sem cobertura dos
transportes e entrada do webhook. Classificação: BLOCKER; nenhuma implementação
ou serviço de produção foi iniciado. Retomar esse gate somente de forma explícita.

## Estratégia preservada para a retomada

- Um novo Supabase de produção na organização wacrm; nunca um projeto por cliente.
- Git/migrations como source of truth, incluindo 21G; não importar database.dump.
- Avaliar região por localização/latência VPS→Supabase. us-east-1 é candidata por
  equivalência ao staging, não decisão final sem verificar a localização da VPS.
- Auth independente: planejar Site URL/redirects para https://crm.luizangelo.com.br,
  SMTP, confirmação de email, política de senha, rate limits/providers/MFA e
  leaked-password protection conforme plano. Nenhuma configuração Auth alterada.
- Na captura futura, preservar IDs/auth.users/auth.identities e MFA persistente;
  não depender de sessions/refresh_tokens/flow_state/one_time_tokens/challenges.
  Usuários fazem novo login; JWT e credenciais Supabase são próprios de produção.
- ENCRYPTION_KEY: preservar exatamente a chave da aplicação como Docker Secret
  separado de produção, por compatibilidade com ciphertext futuro. Não regenerar.
- Cron secret e Supabase credentials próprios; META_APP_SECRET depende da estratégia
  do App Meta e não deve ser copiado automaticamente. Nenhum secret criado/lido.
- Stack futura wacrm_production; scheduler obrigatoriamente 0 replicas; sem router
  de produção para crm.luizangelo.com.br nesta etapa. Validar somente internamente.
- Buckets avatars/chat-media/flow-media PRIVATE com policies 21G; sem bytes reais.
- Realtime, extensions e advisors serão verificados no novo projeto, não presumidos.
- Monitoramento futuro: health/DB, erros webhook, falhas de delivery WhatsApp e
  estados da outbox; logs sem PII/secrets. Checklist não executado em produção.
- Rollback futuro: bloquear integrações/scheduler de produção; manter/retornar host
  ao staging apenas com decisão explícita sobre writes; nunca dois consumidores
  do mesmo webhook nem dois ambientes recebendo writes simultâneos. Critérios
  objetivos de rollback ainda serão definidos antes do freeze.
- Captura final futura: roles.sql/schema.sql/data.sql + Storage/checksums/config
  fora do banco, em etapa autorizada de freeze. Não gerar captura final agora.

## Relatório parcial — 54 campos solicitados

Campos não executados não representam falha reproduzida de schema: significam
que nenhum projeto de produção existe para validar.

1. RAM VPS total: 3,73 GiB.
2. RAM disponível: 1,32 GiB.
3. Swap: 2,00 GiB total / 1,04 GiB usada.
4. vCPUs: 3.
5. Load: 0,00 / 0,05 / 0,11.
6. Disco livre: 10,20 GiB.
7. Coexistência staging+produção: NÃO APROVADA; orçamento/picos pendentes.
8. Organização Supabase: wacrm, definida pelo usuário; não acessível na conexão atual.
9. Plano Supabase: DESCONHECIDO para wacrm.
10. Custo novo projeto: NÃO OBTIDO; não assumir gratuidade.
11. Aprovação de custo necessária: A DETERMINAR após consulta; qualquer custo adicional exige SIM.
12. Projeto produção criado: NÃO.
13. PROJECT_REF: NÃO CRIADO.
14. Região: PENDENTE.
15. PostgreSQL produção: NÃO PROVISIONADO.
16. Migrations aplicadas em produção: 0.
17. Migration 21G presente em produção: NÃO; presente no Git e staging.
18. Extensions produção: NÃO EXECUTADO.
19. Security advisor produção: NÃO EXECUTADO.
20. Performance advisor produção: NÃO EXECUTADO.
21. RLS produção: NÃO EXECUTADO.
22. Multi-tenancy produção: NÃO EXECUTADO.
23. Account bootstrap produção: NÃO EXECUTADO.
24. Tenant A/B produção: NÃO EXECUTADO.
25. Storage buckets produção: NÃO CRIADOS.
26. Storage isolation produção: NÃO EXECUTADO.
27. Auth configuração: PENDENTE.
28. Sessions/tokens policy: definida SIM, novo login e não transporte de estado transitório.
29. ENCRYPTION_KEY strategy: PRONTA como estratégia, secret de produção ainda não criado.
30. Secrets produção: PENDENTES.
31. External integrations kill switch: BLOCKER.
32. Stack wacrm_production: NÃO CRIADA.
33. Imagem produção: NÃO CONSTRUÍDA; base aprovada ed9ebd7, não basta retag de build com Supabase staging.
34. App produção: NÃO CRIADO / 0 replicas iniciadas.
35. Scheduler produção: NÃO CRIADO / 0 replicas iniciadas.
36. WhatsApp conectado em produção: NÃO.
37. WhatsApp real enviado nesta etapa: NÃO.
38. Meta events produção: projeto não criado; 0 eventos de produção gerados.
39. POST /events: NÃO.
40. crm.luizangelo.com.br: continua staging SIM; nenhuma alteração de router nesta etapa.
41. DNS alterado: NÃO.
42. Freeze executado: NÃO.
43. Dados reais migrados: NÃO.
44. Testes: nenhum teste novo de produção; baseline 21G aprovado, não reexecutado nesta retomada.
45. Typecheck: NÃO REEXECUTADO; baseline 21G PASS.
46. Lint: NÃO REEXECUTADO; baseline 21G 0 erros / 40 warnings.
47. Build: NÃO REEXECUTADO; nenhuma imagem de produção criada.
48. Rollback plan: PENDENTE de critérios objetivos; estratégia preliminar acima.
49. Backup DR histórico: PRESERVADO; nenhum comando desta etapa alterou o backup.
50. Produção vazia tecnicamente pronta: NÃO.
51. GO/NO-GO para 21I: NO-GO.
52. GO/NO-GO para freeze: NÃO nesta etapa.
53. Bloqueios: acesso à organização wacrm/custo desconhecido; kill switch ausente;
    orçamento de coexistência pendente; demais validações dependem do provisionamento.
54. Próxima ação: disponibilizar organização wacrm no conector Supabase (ou login
    CLI seguro), informar seu ID e retomar consulta do custo. Não enviar tokens por chat.

## Git / preservação

Somente este relatório parcial foi criado. Nenhuma alteração de runtime/migration.
Preservadas alterações preexistentes do usuário em production-topology-and-backup.md
e documentos não rastreados 21C/21D/21E/21F. A skill Supabase orientou verificar a
organização/acesso reais e separar autorização de criação de confirmação de custo.
