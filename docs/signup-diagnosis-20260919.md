# Diagnóstico controlado do signup — 2026-09-19

Escopo: somente leitura no WACRM/Supabase `awganmhowivedfocwzjy`. O signup não
foi repetido, nenhuma configuração Auth foi alterada e nenhuma migration foi
executada.

## Causa comprovada

A tentativa sintética usou um endereço `wacrm-smoke-…@example.org`. O catálogo
atual de erros do Supabase Auth define `email_address_invalid` como a rejeição de
domínios de exemplo/teste: “Example and test domains are currently not
supported. Use a different email address.” A documentação foi consultada pelo
MCP oficial do Supabase; referência pública:
<https://supabase.com/docs/guides/auth/debugging/error-codes>.

Classificação: **C — SUPABASE_AUTH_REJECTION**.

Não é falha do signup WACRM. O endereço passa pela validação sintática local,
mas é recusado pelo provedor antes de qualquer INSERT em `auth.users`. A
correção mínima é usar, numa futura execução separadamente autorizada, um
endereço controlado em domínio real não reservado. Não há PATCH de Auth nem
alteração de runtime a fazer nesta etapa.

## Sequência e evidências

1. O smoke passou pelos checks HTTP prévios e entrou na fase `signup` usando
   `Origin` correto, JSON, nome válido e senha base64url aleatória de 32
   caracteres.
2. A rota `/api/auth/signup` aceita sintaticamente o domínio `example.org`,
   exige pelo menos oito caracteres e chama `supabase.auth.signUp()` somente
   após confirmar que o browser não possui usuário autenticado.
3. O Supabase Auth rejeita o domínio reservado. A rota deliberadamente não
   expõe o erro bruto e converte um `AuthError` retornado em HTTP 400 com mensagem
   genérica. O harness anterior não preservou o status/código upstream; portanto
   o HTTP bruto do `/auth/v1/signup` não está disponível retrospectivamente.
4. Na janela 2026-09-18 21:25–21:40 UTC, os logs do app tinham cinco linhas e
   nenhuma entrada de signup/Auth/erro; `auth.audit_log_entries` tinha zero
   registros e `auth.users` tinha zero criação.
5. Permanecem zero usuários/identidades sintéticos com o padrão do smoke e zero
   profile/account sintéticos. Isso comprova que a rejeição ocorreu antes do
   trigger `on_auth_user_created` e do bootstrap transacional.

## Exclusões verificadas

- **Rate limit:** descartado. Não há HTTP 429, erro de rate limit, audit event ou
  repetição da tentativa; a causa específica do domínio explica a rejeição.
- **Senha:** descartada. Frontend e servidor compartilham o mínimo WACRM de 8;
  o smoke usou 32 caracteres compatíveis. Não há schema Zod paralelo.
- **Autoconfirm/session:** descartado. `mailer_autoconfirm=true` foi reconfirmado
  e a rota aceita corretamente tanto `data.session` presente quanto ausente,
  retornando apenas `hasSession`.
- **Bootstrap:** não executado. O trigger está ativo, chama
  `public.handle_new_user()` como `SECURITY DEFINER`, com `search_path` fixo;
  constraints/FKs relevantes estão válidas e o fluxo já possui regressões
  isoladas. Nenhum usuário Auth chegou a ser inserido.
- **Invitation flow:** não envolvido. O smoke não usou `inviteToken`; convites só
  são resgatados explicitamente depois do signup autenticado.
- **Rede/infra:** descartada para esta falha. O endpoint Auth settings respondeu
  HTTP 200 e o serviço permaneceu saudável.

## Configuração somente leitura

| Item | Evidência atual |
| --- | --- |
| `disable_signup` | `false`, reconfirmado no endpoint público |
| Email provider | habilitado, reconfirmado |
| `mailer_autoconfirm` | `true`, reconfirmado |
| `password_min_length` | 6 é o contexto administrativo anterior; não exposto pelo endpoint público atual |
| `password_required_characters` | não exposto pela conexão pública/MCP disponível |
| `security_captcha_enabled` | falso no contexto administrativo anterior; não exposto pelo endpoint público atual |
| `rate_limit_email_sent` / `rate_limit_verify` | não expostos pela conexão pública/MCP disponível |
| App Site URL | `https://crm.luizangelo.com.br`, runtime reconfirmado |
| Auth Site URL | não exposto pela conexão pública/MCP disponível |

Não foi usado navegador porque nenhuma superfície estava disponível. Também não
foi obtido acesso de escrita/Management API para preencher lacunas administrativas.

## Próximo passo — não executado

Preparar um único smoke futuro com endereço controlado em domínio real não
reservado e ajustar o harness operacional para preservar somente `HTTP status`,
`error.code` e mensagem sanitizada. Executar apenas mediante autorização
separada, pois criará Auth user, account, profile e pipeline quando bem-sucedido.
