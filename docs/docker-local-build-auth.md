# Docker local e imagem Auth WACRM — build concluído, sem deploy

18/09/2026. Autorização desta etapa limitada à preparação do Mac, build e validação local. **Nenhuma imagem enviada à VPS, nenhuma migration aplicada, nenhum serviço produtivo atualizado.**

## Relatório solicitado

1. **macOS:** 26.6.2, build 25G83, detectado com `sw_vers`.
2. **Arquitetura do Mac:** Apple Silicon `arm64`, 8 CPUs lógicas, 8 GiB RAM física. Memory pressure inicial informou 40% de memória livre/reclamável; isso não significa 40% de páginas físicas livres (há compressão/swap no Mac).
3. **Solução escolhida:** Docker Desktop oficial para Apple Silicon. Compatível: bundle exige macOS >=14.0; fonte oficial descreve suporte às versões atuais/recentes. Evitou instalar Homebrew/Colima/QEMU separados. [Instalação e requisitos oficiais](https://docs.docker.com/desktop/setup/install/mac-install/).
4. **Componentes instalados:** `/Applications/Docker.app`, Docker CLI e plugins incluídos pelo fornecedor. Symlink de CLI em `/Users/luizangelo/.docker/bin/docker`, contexto local `desktop-linux`. Não instalou Homebrew/Colima/OrbStack/Rosetta, não ativou Swarm/Kubernetes, não fez Docker login ou contratação de plano. O daemon/containers rodam na VM local, não na VPS. [Permissões e instalação por usuário](https://docs.docker.com/desktop/setup/install/mac-permission-requirements/).
5. **Versões:** Docker Desktop 4.91.0 (239619), CLI/Engine 29.8.0, API 1.56, containerd 2.3.4, runc 1.4.3, Buildx 0.37.0, Compose 5.5.1. Node da imagem 24.21.0; Next.js 16.3.3.
6. **Disco antes/depois:** volume Data 228 GiB; disponível inicialmente ~52 GiB, depois ~46 GiB; usado ~149 →155 GiB. Inclui aplicativo, instalador retido, VM/cache/artefatos Docker. Não executou prune/exclusão global. Instalador foi desmontado ao final, arquivo mantido em diretório privado.
7. **`docker version`:** cliente darwin/arm64 e servidor linux/arm64 responderam; ambos 29.8.0, contexto desktop-linux. Daemon funcional, não apenas CLI instalada.
8. **`docker info`:** linux/aarch64, 8 CPUs, memória da VM 4106604544 bytes (~3.82 GiB), Swarm inactive; ao final 1 imagem e 2 containers de smoke parados, nenhum consumidor/scheduler WACRM local ativo. Configuração/defaults Docker, sem daemon remoto.
9. **VPS detectada:** consulta SSH estritamente read-only `uname -m`/versão Docker: x86_64, Docker server amd64/linux. Nenhum build, load, update ou alteração de stack na VPS.
10. **Plataforma de build:** explicitamente `linux/amd64`, não arquitetura padrão arm64 do Mac. Emulação disponibilizada pelo Docker Desktop.
11. **SHA:** `07258bd2618462111dc78a3065152764ce64263f`, branch main. Build feito de `git archive` desse commit em diretório privado, não da árvore dirty. Alterações pré-existentes não commitadas foram preservadas e não entraram na imagem. Nenhum novo commit de aplicação nesta etapa.
12. **Tag:** `wacrm-staging:07258bd` (nome legado preservado).
13. **Image ID retornado pelo Docker local:** `sha256:1e5cbb7cac91b2d8aa33b589c1131013fb5747a49d4bf04fb27adb0409c7b231`. Este daemon usa armazenamento containerd/OCI e retorna o digest do índice local; não confundir com config digest `sha256:65d7dc1ee2a57d16eb8bd9c4e5a542f32059f611658889e2b8c2522801b1901c`. Manifest da plataforma: `sha256:deda25a189b8ed1264a473a29c67fb2953371bf55e70d4ce9f836aab452713e5`. Sem registry push/RepoDigest remoto.
14. **Tamanho:** `329661781 bytes`, ~314.4 MiB, conforme `docker image inspect`.
15. **Build:** PASS, exit code 0. Dockerfile original, `npm ci` pelo lockfile, produção Next compilada/TypeScript/static pages/standalone e export Docker concluídos. Nenhuma alteração para contornar erro de build; nenhuma dependência atualizada. `npm ci` informou zero vulnerabilidades na auditoria executada nessa instalação (não substitui auditoria de segurança integral da imagem).
16. **Validações:** inspect confirma linux/amd64, usuário nextjs, ausência de variáveis privadas de secret na configuração da imagem. Smoke em container `--network none`, limite 768 MiB/2 CPUs, sem portas publicadas/mounts/credenciais reais; runtime só parâmetros fictícios de teste. Login/signup/forgot/reset HTTP 200; forgot/reset contêm orientação administrativa. Signup e alteração de senha com 7 caracteres HTTP 400; recovery com 8 HTTP 403 (suporte-only). Zero arquivos `.env*`, `.pgpass` ou database.dump encontrados nos diretórios superiores app/.next verificados. Ambos os containers de teste foram parados; nenhum login/signup/password/e-mail real realizado. Login autenticado, entrega de e-mail e demais integrações reais não foram homologados, por escopo.
17. **Warnings:** download HTTP/2 foi interrompido e retomado por HTTP/1.1; arquivo final conferiu SHA-256 oficial `31a324e8f72acf178c9f5d46cd71240705541faa69827588813e539d29c7e859`, codesign passou e Gatekeeper accepted/Notarized Developer ID. Tentativa de instalador CLI `--accept-license` falhou ao gravar em /Library por permissão; não usou sudo/senha nem contornou proteção. Aplicativo instalado pela alternativa normal de cópia para Applications, configuração do usuário; login opcional pulado. A condição de licença empresarial permanece responsabilidade do operador; não assumimos elegibilidade universal nem contratamos plano. Primeiro smoke usou Origin localhost e falhou: NEXT_PUBLIC_SITE_URL é embutido no build com o domínio oficial. Teste ajustado para header Origin oficial, mantendo destino loopback/sem rede; imagem/Dockerfile não alterados, smoke final PASS. Build preservou avisos middleware→proxy/Edge/static-generation, pacote whatwg-encoding deprecado e avisos npm install-scripts/update; nenhuma correção fora do escopo.
18. **Produção:** não alterada pelo operador. Imagem anterior `wacrm-staging:ed9ebd7` não foi substituída. Sem transporte/load/export para VPS, service update, stack deploy, restart, cron manual ou CAPI/WhatsApp. Portainer pode continuar sendo usado para gestão/deploy futuro, que exige nova autorização.
19. **Migration:** NÃO aplicada nesta etapa; última verificação produtiva da etapa anterior confirmou ausência de `20260918161120`, ledger 48. Esta etapa não consultou nem alterou Supabase/Management API. Não interpretar o build concluído como liberação de CHANGE EMAIL em produção: trigger ainda depende de aplicação/validação autorizada.
20. **Secrets:** nenhum valor privado exibido ou incluído como build arg. Contexto imutável não contém `.env.local`/Docker secrets/libpq files; .dockerignore original exclui arquivos privados de ambiente. Apenas os quatro NEXT_PUBLIC_* existentes foram permitidos no filho de build; chave pública conferida como anon/ref WACRM, valor não impresso. service_role/ENCRYPTION_KEY/cron secret/Meta secret e demais variáveis privadas não foram transmitidos ao build. Os valores públicos são legitimamente embutidos no frontend; chave anon não é credencial administrativa. Smoke não recebeu secrets reais e não podia acessar rede externa. Shodisparo, Meta, DNS, SMTP, Auth externo e banco produtivo permaneceram intocados.

## Artefatos e limites

Diretório operacional privado: `/Users/luizangelo/Backups/wacrm/docker-local.UGOlt6`.
Contém instalador oficial verificado, source archive do commit, helpers de build/validação, build.log sanitizado, build-result.json e validation-result.json. Helpers operacionais fora do repositório; este relatório é novo arquivo local não commitado. Não armazena credencial administrativa. Mac recebeu somente instalação/configuração Docker e artefatos de build autorizados. Nenhuma configuração do Dockerfile/stack foi modificada.

O Dockerfile standalone existente **não empacota scripts/admin-auth-user.mjs** no runner. CLI deve ser distribuída como artefato administrativo restrito em próxima etapa aprovada, sem endpoint web e sem copiar secrets para arquivo de código. Não afirmar que `npm run admin:auth-user` já está disponível na imagem da aplicação.

Comandos para conferir localmente, sem exibir envs:

```sh
docker --context desktop-linux version
docker --context desktop-linux info
docker --context desktop-linux image inspect wacrm-staging:07258bd --format 'image_id={{.Id}} os={{.Os}} arch={{.Architecture}} size_bytes={{.Size}}'
```

**Parar aqui.** Próxima etapa requer nova autorização para transporte da imagem, revalidação/renovação do backup, migration única, deploy app e distribuição/inspect da CLI administrativa. Não transportar imagem nem aplicar migration com base nesta autorização de build local.
