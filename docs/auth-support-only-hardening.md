# Auth WACRM — suporte administrativo, sem SMTP

Preparação local em 18/09/2026. **Não implantado; migration não aplicada à
produção.** Único WACRM produtivo: `crm.luizangelo.com.br`, projeto
`awganmhowivedfocwzjy`, serviço legado `wacrm_staging_app`.

## 1. Diagnóstico anterior e evidências

- Schema produtivo consultado somente com SELECT: `profiles.id` é PK própria;
  `profiles.user_id` é NOT NULL, UNIQUE e FK para `auth.users.id`.
- `profiles.email` é text NOT NULL; `account_id` é NOT NULL e FK para accounts;
  `account_role` é enum NOT NULL. Não existe tabela `account_members` neste
  modelo: membership é representada por profiles/account_id/account_role e RPCs.
- Trigger Auth existente `on_auth_user_created` é AFTER INSERT e executa
  `handle_new_user`, bootstrap transacional da 21G. Não havia trigger de UPDATE
  sincronizando e-mail.
- `supabase_auth_admin` não possui UPDATE sobre public.profiles; RLS habilitado.
  Isso justifica o SECURITY DEFINER estritamente interno da nova migration.
- Signup exigia 6 no cliente e sempre anunciava confirmação enviada. A decisão
  administrativa vigente é autoconfirm=true, sem SMTP próprio.
- PasswordForm validava a senha antiga usando `profile.email`, uma cópia que
  poderia ficar obsoleta após mudança administrativa no Auth.
- ForgotPassword enviava recovery e anunciava e-mail; ProfileForm solicitava
  mudança de e-mail com confirmação nos dois endereços.
- Convites reais são links opacos compartilhados manualmente. WACRM não envia
  convite por e-mail. Não foram encontradas chamadas `auth.admin` no código
  operacional existente de src/deploy, nem adicionadas nesta implementação.
- Valores administrativos adicionais de Auth fornecidos pelo usuário nesta
  etapa são contexto, não uma nova homologação de Management API. Nenhum PATCH,
  envio de e-mail, signup ou alteração de usuário real foi executado.

## 2. Arquivos desta implementação

Novos:

- `src/lib/auth/policy.ts`: mínimo 8, mensagens e flag estática de recuperação.
- `src/lib/auth/request.ts`: JSON same-origin, rejeição de Origin ausente/externo.
- `src/app/api/auth/signup/route.ts`: validação de cadastro no servidor.
- `src/app/api/auth/password/route.ts`: validação de nova senha e senha atual.
- `src/components/auth/password-support-card.tsx`: orientação administrativa.
- `src/lib/auth/email-sync-database.test.ts`: SQL real em PGlite isolado.
- `src/app/api/auth/auth-routes.test.ts`: endpoints com Auth inteiramente mockado.
- `src/components/auth/auth-support-flows.test.tsx`: regressões de interface.
- `supabase/migrations/20260918161120_sync_auth_email_to_profile.sql`.
- Este relatório/runbook.

Modificados:

- `src/app/(auth)/signup/page.tsx`.
- `src/app/(auth)/forgot-password/page.tsx`.
- `src/app/(auth)/reset-password/page.tsx`.
- `src/components/settings/password-form.tsx`.
- `src/components/settings/profile-form.tsx`.
- `supabase/tests/21g_native_regression.mjs`.
- `supabase/tests/21g_concurrency_regression.mjs`.

Alterações pré-existentes em README/deploy/runbooks 21C–21H foram preservadas;
não pertencem a este patch de Auth. Nenhum commit foi criado automaticamente.

## 3–4. Migration e sincronização

Migration criada pelo CLI Supabase 2.117.0 via `migration new`.
Pré-requisito: 21G aplicada, incluindo schema privado `wacrm_private`.

`wacrm_private.sync_auth_email_to_profile()` é trigger-only, SECURITY DEFINER,
`search_path=pg_catalog,pg_temp`, com tabela totalmente qualificada. EXECUTE é
revogado de PUBLIC, anon, authenticated e service_role. O schema já não é
exposto aos clientes. Contexto diferente de UPDATE em auth.users é rejeitado.

AFTER UPDATE OF email, com WHEN OLD.email IS DISTINCT FROM NEW.email, atualiza
somente `public.profiles.email`, por `user_id=NEW.id`. Não usa profile PK,
e-mail anterior como chave nem metadados editáveis de autorização. Não insere
profile/account nem altera account_id, account_role, user_id, owner ou convites.
O trigger de updated_at continua funcionando normalmente.

Não sincroniza `email_change` pendente: somente o e-mail efetivamente vigente.
NULL Auth é representado por string vazia, respeitando NOT NULL da cópia.
Reconciliação inicial atualiza apenas cópias divergentes de perfis existentes.
Trigger/função podem ser reaplicados sem duplicação; cópias iguais são no-op.
Migrations históricas e proteções 21G não foram editadas.

## 5. Signup

Interface em português; POST same-origin `/api/auth/signup` valida mínimo 8 e
dados permitidos antes de chamar Auth. Não aceita account_id, account_role ou
metadados arbitrários. Bloqueia signup se já houver usuário autenticado.
Usa cliente SSR com chave pública e cookies, não cliente administrativo.

Auth signUp continua sendo a única criação: bootstrap de account/profile fica
no trigger transacional existente. Resposta não expõe user/session/token; só
`hasSession`. Com sessão: “Conta criada” e Continue → dashboard ou join/token.
Sem sessão inesperadamente: “Cadastro recebido”, login/suporte, sem promessa de
envio. Convite exige aceitação explícita no fluxo existente; nunca é resgatado
silenciosamente no cadastro.

## 6. Forgot/reset

`AUTH_EMAIL_SELF_SERVICE_ENABLED=false`, decisão explícita no código, sem
inventar configuração de SMTP por inferência. Forgot e reset mostram apenas
“Entre em contato com o administrador para redefinir sua senha.” Não montam
formulário de recovery/reset nem chamam Auth nesses componentes.

Código antigo de solicitação de recovery e callback foi preservado para futuro
rollout. O endpoint de senha também rejeita mode=recovery enquanto a flag está
false. Reativação exige SMTP/hook, templates, redirects/callback PKCE e revisão
da autorização da sessão de recovery; **não basta mudar a flag em produção**.

## 7. Change email/profile

E-mail exibido read-only, preferindo user.email; mensagem de contato com o
administrador. Salvar perfil continua alterando somente nome/avatar e filtrando
por user_id. Nenhuma chamada updateUser(email), nenhum aviso de confirmação
enviada. Suporte interno à mudança administrativa permanece no Supabase Auth
Admin API e na nova sincronização; endpoint/script de suporte fica para Prompt 2.

## 8. Senhas

Política compartilhada: mínimo 8 no signup, nova senha, reset preservado e
validações dos endpoints. Senha não é trimada. Login/senha atual não recebem
minLength=8 para não bloquear credenciais legadas válidas.

Change password obtém getUser no servidor, usa somente user.email real e exige
senha atual. Verificação usa cliente público isolado sem persistência, refresh
automático ou cookies; impede troca de identidade do navegador durante a
verificação. Só atualiza no cliente da sessão original se o ID autenticado for
o mesmo. Limite por usuário reutiliza RATE_LIMITS.adminAction. Sem logs de body,
senha, session ou erros brutos do fornecedor.

**Supabase global continua em 6.** Chamadas diretas à API pública do Auth podem
contornar a política WACRM; nenhum endpoint interno consegue mudar essa política
global sem ajuste administrativo. Isso deve continuar explícito.

## 9–13. Testes e verificações

32 testes novos: A sincroniza; B intacto mesmo com PKs de profiles cruzadas;
tenant/role/accounts/convites intactos; email_change não confirmado não sincroniza;
NULL/orphan/reaplicação/ACL/search_path; 7 falha/8 passa em servidor e UI;
signup session/no-session e convites; recovery sem HTTP; perfil read-only;
senha antiga incorreta/identidade diferente; Origin externo/ausente e erros sem
secrets. Todos os fornecedores são mockados nos testes de endpoint/UI.

Resultados:

| Verificação                                        | Resultado                      |
| -------------------------------------------------- | ------------------------------ |
| Vitest relevante                                   | 32/32 PASS                     |
| Vitest completo                                    | 125 arquivos, 1484 testes PASS |
| Node existentes                                    | 21/21 PASS                     |
| PostgreSQL nativo 17 + 21G + nova migration        | 139 observações PASS           |
| Concorrência PostgreSQL nativo 17 + nova migration | 3 cenários PASS                |
| Typecheck                                          | PASS                           |
| Lint                                               | 0 erros; 40 warnings legados   |
| Next production build local                        | PASS                           |
| git diff --check                                   | PASS                           |

Native executa a SQL nova em transação no laboratório privado, usando role real
supabase_auth_admin. Repete isolamento RLS/roles/accounts/invitations,
notifications/WhatsApp/Meta/Storage da 21G. Compara fingerprints históricos antes
e depois de ROLLBACK. Concorrência usa clone exclusivo, removido ao final;
restore original intacto. PostgreSQL parado ao final; sandbox nega rede IP;
nenhum app/scheduler conectado. Artefatos novos ficam no backup local privado,
sem sobrescrever os relatórios históricos 21G.

Comandos de verificação (somente testes locais):

```sh
npm test
node --test deploy/migration-equivalence.test.mjs deploy/staging/meta-conversions-scheduler.test.mjs deploy/staging/21g_runtime_check.test.mjs
npm run typecheck
npm run lint
NEXT_TELEMETRY_DISABLED=1 npm run build
WACRM_RESTORE_ROOT=/Users/luizangelo/Backups/wacrm/staging/2026-09-17_145605 WACRM_AUDIT_CATALOG=/tmp/wacrm-saas-audit-catalog.json WACRM_AUTH_EMAIL_MIGRATION=/Users/luizangelo/Documents/wacrm/wacrm/supabase/migrations/20260918161120_sync_auth_email_to_profile.sql node supabase/tests/21g_native_regression.mjs
WACRM_RESTORE_ROOT=/Users/luizangelo/Backups/wacrm/staging/2026-09-17_145605 WACRM_AUTH_EMAIL_MIGRATION=/Users/luizangelo/Documents/wacrm/wacrm/supabase/migrations/20260918161120_sync_auth_email_to_profile.sql node supabase/tests/21g_concurrency_regression.mjs
```

Primeira execução de testes detectou mock de profile instável, tipos genéricos
ausentes no teste SQL e output JSON de snapshot confundindo o parser nativo;
corrigidos no harness. Resultados finais acima são das execuções corrigidas.

## 14. Riscos e limitações

- Não homologa login/signup ou cookies em navegador/produção. Nenhuma mensagem,
  usuário real, recovery ou convite foi criado para teste.
- Sem SMTP: recuperação e troca administrativa dependem de suporte disponível,
  validação da identidade do solicitante e procedimento seguro do Prompt 2.
- Cadastro público direto ao Auth segue permitido, sem CAPTCHA, com mínimo 6 e
  sem confirmação de posse do e-mail, por decisão atual. Não é hardening global.
- Cadastro e verificação de senha passam a sair da VPS: rate limits Auth por IP
  podem agregar clientes. Não confiar em header de IP recebido sem validação;
  não alteramos forwarding/rate limits externos nesta etapa.
- Profile.email segue uma cópia para exibição, não autoridade de autenticação.
- Leaked protection indisponível no Free; risco residual documentado em
  [password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Advisor produtivo somente lido: avisos prévios de vector em public,
  [RPCs anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
  [RPCs authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
  e fila interna sem policies permanecem, conforme análise 21G; não removemos
  grants de RPCs intencionais. Nova função privada validada por ACL local.
- Build mantém deprecações conhecidas de middleware/Edge e warning de lockfile
  fora do repo. Docker não disponível no terminal local: imagem Docker não foi
  construída nem ensaiada nesta etapa. Build pesado não deve disputar recursos
  na VPS compartilhada sem aprovação/orçamento.

## 15. Plano e comandos de deploy — NÃO EXECUTADOS

Exigem autorização posterior. Primeiro selecionar/commitar somente este patch,
repetir checks, backup aprovado, confirmar destino/ledger/RLS/role migration,
e construir em worker Docker Linux/amd64 com fonte aprovada. Não usar db push
indiscriminadamente: histórico já contém versões diferentes com SQL equivalente.
Não reaplicar migrations antigas. Não usar --prune.

Build em worker com apenas variáveis públicas carregadas de forma segura;
sem set -x, .env privada, service role ou secrets de runtime no build:

```sh
docker build --platform linux/amd64 --build-arg NEXT_PUBLIC_SUPABASE_URL --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY --build-arg NEXT_PUBLIC_SITE_URL --build-arg NEXT_PUBLIC_APP_LOCALE -t wacrm-staging:auth-support-20260918 .
docker save wacrm-staging:auth-support-20260918 | ssh root@5.161.111.81 'docker load'
```

Migration única com ledger na mesma transação, usando service PostgreSQL já
configurado para awganmhowivedfocwzjy. Não ler/imprimir .pgpass. Executar abaixo
somente na fonte aprovada, após confirmar equivalência/ausência desta migration
no ledger. O gate aborta se version ou SQL equivalente já constar:

```sh
node --input-type=module <<'NODE'
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const sql=readFileSync('supabase/migrations/20260918161120_sync_auth_email_to_profile.sql','utf8');
const delimiter='$wacrm_auth_sql$';
if(sql.includes(delimiter)) throw Error('SQL delimiter collision');
const literal=delimiter+sql+delimiter;
const input=`BEGIN;
SELECT pg_advisory_xact_lock(20260918,161120);
DO $gate$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
   WHERE version='20260918161120' OR trim(array_to_string(statements,E'\\n'))=trim(${literal}))
 THEN RAISE EXCEPTION 'Migration already registered; reconcile before proceeding'; END IF;
END $gate$;
${sql}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES('20260918161120','sync_auth_email_to_profile',ARRAY[${literal}]);
COMMIT;`;
const result=spawnSync('psql',['service=wacrm_staging','-X','-v','ON_ERROR_STOP=1'],
 {input,stdio:['pipe','ignore','ignore']});
if(result.error || result.status!==0) throw Error('Migration failed; stop. Do not deploy or retry blindly.');
console.log('Migration transaction completed. Verify ledger, ACL and aggregate email consistency.');
NODE
```

Se houver falha, parar; psql encerra e transação não confirmada é revertida.
Após sucesso, validar read-only função/trigger/ACL/ledger e contagem de e-mails
divergentes, sem imprimir PII. Então atualizar somente app e persistir imagem
na seção app do manifesto legado, mantendo scheduler inalterado:

```sh
ssh root@5.161.111.81 'cp /opt/wacrm-staging/stack.yml /opt/wacrm-staging/stack.yml.before-auth-support-20260918'
ssh root@5.161.111.81 'sed -i "/^  app:/,/^  meta_conversions_scheduler:/s/image: wacrm-staging:ed9ebd7/image: wacrm-staging:auth-support-20260918/" /opt/wacrm-staging/stack.yml'
ssh root@5.161.111.81 'docker service update --image wacrm-staging:auth-support-20260918 --update-order stop-first --detach=false wacrm_staging_app'
ssh root@5.161.111.81 'docker stack services wacrm_staging'
```

Gate: confirmar imagem anterior ed9ebd7 antes desses comandos, tag nova ainda
inexistente e resultado da edição apenas no app; se estado mudou, parar e
recalcular plano. stop-first pode causar breve indisponibilidade do app; aprovação
de janela necessária. Não escalar/reiniciar scheduler ou executar cron manual.
Depois homologar apenas os fluxos autorizados; não criar tráfego WhatsApp/Meta.

## 16. Rollback proposto — NÃO EXECUTADO

Preferir reverter somente a imagem app para a ed9ebd7 pós-21G, mantendo migration
aditiva de sincronização. Restaurar manifesto salvo e validar serviço/isolamento:

```sh
ssh root@5.161.111.81 'cp /opt/wacrm-staging/stack.yml.before-auth-support-20260918 /opt/wacrm-staging/stack.yml'
ssh root@5.161.111.81 'docker service update --image wacrm-staging:ed9ebd7 --update-order stop-first --detach=false wacrm_staging_app'
```

Não restaurar backup inteiro nem imagem pré-21G, não reverter emails para cópias
obsoletas, não alterar eventos Meta. Caso comprovadamente necessário remover
o trigger, criar nova migration compensatória aprovada com DROP TRIGGER específico
e DROP FUNCTION privada, sem CASCADE; não editar/apagar ledger nem migration
histórica. Nenhum rollback foi executado.

## 17. Limites respeitados

Não tocou projeto Shodisparo zyqbgrrpedzxfcwhlfoa; Meta; DNS; SMTP/Resend;
configuração administrativa externa de Auth; Management PATCH; usuários reais.
Não fez deploy, migration produtiva, recovery, cron manual, mensagens ou CAPI.
Não leu/imprimiu .pgpass nem expôs tokens, passwords, keys ou outros segredos.
Somente SQL read-only no WACRM produtivo, docs oficiais, código local e testes
isolados. Parar e aguardar autorização de próxima etapa.
