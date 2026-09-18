# Suporte administrativo temporário de Auth

CLI Node server-side para manutenção ocasional pelo **operador técnico autorizado que já detém a credencial administrativa do projeto**. Não é um recurso para administradores de contas SaaS: a service_role é privilegiada em todo o projeto. Nunca entregar a ferramenta/credencial aos clientes, importar em `src/`/browser ou publicar como endpoint.

Único destino permitido: WACRM `awganmhowivedfocwzjy`, produção `https://crm.luizangelo.com.br`. O projeto Shodisparo `zyqbgrrpedzxfcwhlfoa` é bloqueado. Nenhum provisionamento, SMTP, deploy ou operação real foi realizado no desenvolvimento desta CLI.

## Pré-requisitos e credenciais

- Node 22 LTS (com `--env-file-if-exists`) e dependências existentes instaladas.
- Terminal TTY privado, sem gravação de terminal, compartilhamento de tela, `tee`, pipe, redirecionamento, shell tracing (`set -x`) ou depuração HTTP/SDK.
- URL `NEXT_PUBLIC_SUPABASE_URL` ou `SUPABASE_URL` igual à origem HTTPS aprovada; se ambos existirem, devem concordar.
- Credencial **existente** `SUPABASE_SERVICE_ROLE_KEY` no ambiente seguro; alternativamente, o Docker Secret existente `/run/secrets/wacrm_staging_supabase_service_role` (nome legado, produção in-place). Não copiar para novo arquivo, comando, chat ou runbook. Não usar token de usuário nem chave pública.
- A versão atual exige JWT service_role com `ref` WACRM. Chaves opacas `sb_secret_*` são recusadas porque não demonstram esse vínculo localmente. A inspeção do JWT é apenas proteção de destino: o gateway Supabase valida sua assinatura.
- **Antes de usar alteração de e-mail, aplicar e validar em etapa autorizada a migration `20260918161120_sync_auth_email_to_profile.sql`. Ela ainda não foi aplicada à produção nesta implementação.** Sem o trigger, Auth pode mudar enquanto o perfil permanece antigo. A CLI detecta e reporta essa inconsistência, mas não executa rollback nem atualiza o perfil manualmente.
- Verificar identidade do solicitante por canal confiável, autorização para suporte e a conta correspondente antes de operar. Autoconfirm não comprova posse do novo e-mail. Mudança administrativa não envia confirmação e pode conceder acesso ao endereço digitado.

## Execução local segura

No diretório do repositório, usando a configuração segura já existente:

```sh
npm run admin:auth-user
```

Esse comando lê `.env.local` pelo próprio Node sem exibir valores. Não adicionar senha/token a argumentos; a CLI recusa qualquer argumento. Usar somente máquina confiável e arquivo já protegido/não versionado. Não colocar secrets em `package.json`.

No ambiente servidor/VPS, após disponibilizar a versão da ferramenta por deploy **separadamente autorizado**, executar em TTY no container WACRM correto e no diretório que contenha `scripts/` e `node_modules`:

```sh
node scripts/admin-auth-user.mjs
```

A imagem atual não deve ser presumida como contendo `scripts/`: o Dockerfile empacota a aplicação standalone. Distribuir a CLI como artefato operacional restrito, junto das dependências, em etapa posterior autorizada; não copiar secrets nem modificar stack/imagem agora. Não há endpoint público administrativo. Um `docker exec` exige `-it` e seleção prévia do container WACRM exato, nunca Shodisparo.

## Menu e identificação

1. Redefinir senha.
2. Alterar e-mail.
3. Consultar usuário, sem alterações.
4. Sair.

Informar **e-mail Auth atual** ou UUID Auth. Por e-mail, a ferramenta percorre todas as páginas e exige correspondência única; por UUID exige ID exato. Exige perfil WACRM único por `profiles.user_id`, com vínculo de conta. Exibe somente user ID e e-mail atual. Conferir esses dois dados contra o pedido autorizado. IDs não são senha, mas o e-mail é dado pessoal necessário à identificação: não compartilhar a saída indiscriminadamente.

Cada execução realiza no máximo uma manutenção. Cancelar com Ctrl-C ou confirmação diferente; nenhuma operação é feita antes de confirmação. Uma nova leitura antes da mutation impede alteração se identidade, perfil ou vínculo tiver mudado durante os prompts. Isso não é transação distribuída nem elimina toda corrida com outro operador: evitar manutenção simultânea do mesmo usuário.

## Reset de senha

Selecionar 1, localizar o usuário e digitar exatamente `RESET <user_id>` quando solicitado. Digitar uma senha fornecida de forma segura, com mínimo de 8 caracteres, e repetir. Os dois prompts não têm eco, nem asteriscos. Preferir senha longa e exclusiva; combinar entrega ao titular por canal seguro, nunca histórico do shell, ticket público ou arquivo.

Há uma única chamada oficial `auth.admin.updateUserById(userId, { password })`. Não usa SQL, não cria usuário/identidade, não altera contas/roles ou usuário B. O retorno, identidade Auth e perfil/vínculo são verificados. A senha não pode ser lida de volta: essa verificação confirma aceitação da API, não faz login automático. O titular deve conferir o próximo login por conta própria.

## Alteração de e-mail

Selecionar 2, localizar o usuário, informar o novo e-mail e conferir o endereço apresentado. Digitar exatamente `ALTERAR <user_id>`. Há uma única chamada `updateUserById(userId, { email })`, sem fluxo SMTP de confirmação. O endereço é validado e normalizado com trim/lowercase.

A ferramenta lê novamente Auth e `profiles` e exige o novo e-mail nos dois, bem como os mesmos ID, user_id, account_id e account_role. A cópia do perfil deve ser atualizada **somente pelo trigger** da etapa anterior. Não altera membership nem dispara bootstrap de novo usuário.

Se houver erro da API, timeout, retorno ambíguo ou falha de sincronização: **não repetir automaticamente**. Exit code 1 não prova ausência de alteração. Consultar estado Auth/perfil read-only, preservar evidência sanitizada e investigar o trigger; não corrigir por SQL/manual nesta ferramenta. O operador deve tratar divergência como erro/alteração parcial, nunca sucesso. Não há rollback automático.

## Sessões, limites e segurança

- Não implementa revogação automática nem coleta JWT de usuário. `auth.admin.signOut` exige token de sessão, não apenas user_id; não gerar links/login para contornar isso. Em suspeita de comprometimento, planejar revogação em procedimento próprio, explícito e autorizado.
- Não prometer logout imediato de sessões existentes. JWTs já emitidos podem continuar válidos até expirar; mudanças administrativas também não notificam automaticamente clientes. Confirmar estado da sessão e, se necessário, pedir novo login ao titular. No incidente, avaliar janela de validade configurada, inclusive tokens já emitidos.
- A chave é removida de `process.env` depois de criar o cliente; buffers do prompt são zerados e referências de senha descartadas. **JavaScript, SDK, TLS e runtime podem manter cópias na memória; não é apagamento criptográfico garantido.** Evitar core dumps, heap dumps, gravação de teclado/terminal e encerrar o processo após uso.
- Não persiste senha em disco/DB auxiliar, não imprime chave, senha ou erros brutos de provedor. Erros de transporte são sanitizados antes do SDK. Permite somente origem WACRM e endpoints GET Auth/profiles e PUT de usuário; bloqueia redirects, outros métodos e destinos. Não há retry de mutation.
- TLS permanece ativo. A service_role fica apenas no processo Node de suporte, nunca no frontend. Não adicionar credencial pública privilegiada, CAPI, cron, Graph API ou configuração SMTP.
- SMTP próprio continua desativado; esta é solução operacional temporária, não recuperação self-service nem verificação de posse de e-mail.

## Testes e liberação

```sh
npm run test:admin-auth
```

Testes usam mocks e TTY simulado; nenhum usuário real é alterado. Cobrem projeto/chave errados, ausência/ambiguidade/paginação, confirmação, senha mínima/oculta, e-mail inválido, sync/perfil, isolamento A/B, erros sanitizados, zero retry, cancelamento/TTY e argumentos proibidos.

CLI e trigger precisam de liberação autorizada antes do uso produtivo. Testes locais não comprovam que o trigger já existe em produção. Não houve deploy nem alteração de Auth real nesta etapa.

Referências oficiais: [Admin updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid), [Admin listUsers](https://supabase.com/docs/reference/javascript/auth-admin-listusers), [Sessões e revogação](https://supabase.com/docs/guides/auth/sessions).
