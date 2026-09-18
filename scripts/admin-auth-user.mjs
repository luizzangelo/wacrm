// Operational Node-only tool. Never import from src/, public/ or browser code.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

export const PROJECT_REF = 'awganmhowivedfocwzjy';
const ORIGIN = `https://${PROJECT_REF}.supabase.co`;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const EMAIL =
  /^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/;
export class SupportError extends Error {}
const fail = (message) => {
  throw new SupportError(message);
};

export function validateEnvironment(env, key) {
  const urls = [env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_URL].filter(Boolean);
  if (!urls.length || urls.some((url) => url.replace(/\/$/, '') !== ORIGIN)) {
    fail('Projeto bloqueado: somente o Supabase WACRM aprovado é permitido.');
  }
  // Targeting guard, NOT signature verification. The Supabase gateway verifies
  // the credential cryptographically. Opaque keys cannot prove project binding here.
  try {
    if (key.split('.').length !== 3) throw new Error();
    const claims = JSON.parse(
      Buffer.from(key.split('.')[1], 'base64url').toString()
    );
    if (
      claims.ref !== PROJECT_REF ||
      claims.role !== 'service_role' ||
      (claims.exp !== undefined &&
        (!Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000))
    ) {
      throw new Error();
    }
  } catch {
    fail(
      'Credencial bloqueada: exige service_role JWT válido vinculado ao WACRM.'
    );
  }
  return ORIGIN;
}

export function guardedFetch(fetchImpl = globalThis.fetch) {
  return async (input, init = {}) => {
    try {
      const url = new URL(
        typeof input === 'string' ? input : (input.url ?? input.toString())
      );
      const method = (init.method ?? 'GET').toUpperCase();
      const userPath = /^\/auth\/v1\/admin\/users\/[a-f0-9-]{36}$/i.test(
        url.pathname
      );
      const allowed =
        (method === 'GET' &&
          (userPath ||
            url.pathname === '/auth/v1/admin/users' ||
            url.pathname === '/rest/v1/profiles')) ||
        (method === 'PUT' && userPath);
      if (url.origin !== ORIGIN || !allowed) throw new Error();
      // Exactly one transport attempt; never follow redirects or retry a mutation.
      return await fetchImpl(input, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      // auth-js may console.error transport exceptions: never pass raw exceptions.
      throw new Error(
        'Falha de transporte administrativo; não repetir automaticamente.'
      );
    }
  };
}

export function createOperationalClient(env = process.env) {
  if (typeof window !== 'undefined')
    fail('Ferramenta disponível somente no Node server-side.');
  let key = env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    if (!key)
      key = readFileSync(
        '/run/secrets/wacrm_staging_supabase_service_role',
        'utf8'
      ).trim();
    const origin = validateEnvironment(env, key);
    return createClient(origin, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: guardedFetch() },
    });
  } catch (error) {
    if (error instanceof SupportError) throw error;
    fail('Credencial administrativa indisponível no ambiente seguro.');
  } finally {
    key = undefined;
    delete env.SUPABASE_SERVICE_ROLE_KEY;
  }
}

export function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL.test(value);
}

async function getUser(client, id) {
  const { data, error } = await client.auth.admin.getUserById(id);
  if (error || !data?.user || data.user.id !== id)
    fail('Usuário não encontrado ou leitura Auth falhou.');
  return data.user;
}

export async function resolveUser(client, target) {
  target = target.trim();
  if (UUID.test(target)) return getUser(client, target.toLowerCase());
  if (!validEmail(target)) fail('Informe um e-mail válido ou UUID.');
  const matches = [];
  const seen = new Set();
  // Scan all pages to establish uniqueness, rather than choosing the first match.
  for (let page = 1; page <= 10000; page++) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error || !Array.isArray(data?.users))
      fail('Não foi possível concluir a busca Auth.');
    for (const user of data.users) {
      if (!UUID.test(user.id) || seen.has(user.id))
        fail('Paginação Auth inconsistente; ação bloqueada.');
      seen.add(user.id);
      if (user.email?.toLowerCase() === target.toLowerCase())
        matches.push(user);
    }
    if (matches.length > 1)
      fail('Mais de um usuário corresponde ao e-mail; ação bloqueada.');
    if (data.users.length < 200) {
      if (matches.length !== 1) fail('Usuário não encontrado.');
      return matches[0];
    }
  }
  fail('Busca incompleta; ação bloqueada.');
}

async function readProfile(client, user) {
  const { data, error } = await client
    .from('profiles')
    .select('id,user_id,email,account_id,account_role')
    .eq('user_id', user.id)
    .single();
  if (
    error ||
    !data ||
    data.user_id !== user.id ||
    !data.id ||
    !data.account_id ||
    !data.account_role
  ) {
    fail('Perfil WACRM único/vínculo de conta não confirmado; ação bloqueada.');
  }
  return data;
}

function sameMembership(before, after) {
  return ['id', 'user_id', 'account_id', 'account_role'].every(
    (field) => before[field] === after[field]
  );
}

export async function updateTarget(client, user, profile, attributes) {
  const fresh = await getUser(client, user.id);
  const freshProfile = await readProfile(client, fresh);
  if (
    fresh.email !== user.email ||
    freshProfile.email !== profile.email ||
    !sameMembership(profile, freshProfile)
  ) {
    fail('Usuário/perfil mudou durante a confirmação; ação bloqueada.');
  }
  let attempted = false;
  try {
    attempted = true;
    const { data, error } = await client.auth.admin.updateUserById(
      user.id,
      attributes
    );
    if (error || data?.user?.id !== user.id) throw new Error();
    const checked = await getUser(client, user.id);
    const checkedProfile = await readProfile(client, checked);
    const expectedEmail = attributes.email ?? user.email;
    if (
      checked.email !== expectedEmail ||
      data.user.email !== expectedEmail ||
      checkedProfile.email !== expectedEmail ||
      !sameMembership(profile, checkedProfile)
    ) {
      fail(
        'ERRO pós-operação: Auth/perfil não sincronizados ou vínculo mudou. Auth pode ter sido alterado. Não repetir/reverter automaticamente.'
      );
    }
  } catch (error) {
    if (
      error instanceof SupportError &&
      error.message.startsWith('ERRO pós-operação')
    )
      throw error;
    fail(
      attempted
        ? 'ERRO: operação não confirmada. Auth pode ter sido alterado; investigar sem repetir automaticamente.'
        : 'Operação bloqueada antes da alteração.'
    );
  } finally {
    if ('password' in attributes) attributes.password = '';
  }
}

// Raw TTY input: secrets are not echoed, buffered by readline or persisted.
// Fixed buffer is zeroed on every exit. JS strings/SDK copies cannot be securely erased.
export function terminalPrompt(
  label,
  {
    hidden = false,
    input = process.stdin,
    output = process.stdout,
    signals = process,
  } = {}
) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(
      new SupportError(
        'Exige terminal TTY privado; não aceita pipe/redirecionamento.'
      )
    );
  }
  return new Promise((resolve, reject) => {
    const bytes = Buffer.alloc(4096);
    let length = 0;
    const previousRaw = Boolean(input.isRaw);
    const previousPaused = input.isPaused();
    const finish = (error) => {
      const answer = error
        ? undefined
        : bytes.subarray(0, length).toString('utf8');
      bytes.fill(0);
      input.removeListener('data', onData);
      input.removeListener('end', cancelled);
      input.removeListener('error', cancelled);
      signals.removeListener('SIGTERM', cancelled);
      signals.removeListener('SIGINT', cancelled);
      input.setRawMode(previousRaw);
      if (previousPaused) input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(answer);
    };
    const cancelled = () => finish(new SupportError('Operação cancelada.'));
    const onData = (chunk) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (let index = 0; index < data.length; index++) {
        const byte = data[index];
        if (byte === 3 || byte === 4) {
          cancelled();
          return;
        }
        if (byte === 10 || byte === 13) {
          if (
            data
              .subarray(index + 1)
              .some((value) => value !== 10 && value !== 13)
          ) {
            finish(new SupportError('Entrada com múltiplas linhas bloqueada.'));
            return;
          }
          finish();
          return;
        }
        if (byte === 8 || byte === 127) {
          if (length) {
            let start = length - 1;
            while (start > 0 && (bytes[start] & 0xc0) === 0x80) start--;
            bytes.fill(0, start, length);
            length = start;
            if (!hidden) output.write('\b \b');
          }
        } else if (byte < 32 || length >= bytes.length) {
          finish(new SupportError('Entrada inválida ou longa demais.'));
          return;
        } else {
          bytes[length++] = byte;
          if (!hidden) output.write(Buffer.from([byte]));
        }
      }
    };
    output.write(label);
    input.setRawMode(true);
    input.on('data', onData);
    input.once('end', cancelled);
    input.once('error', cancelled);
    signals.once('SIGTERM', cancelled);
    signals.once('SIGINT', cancelled);
    input.resume();
  });
}

const safeDisplay = (value) =>
  String(value ?? '(ausente)').replace(/[\x00-\x1f\x7f-\x9f]/g, '?');
export async function runSupport({
  client,
  prompt = terminalPrompt,
  write = (text) => process.stdout.write(`${text}\n`),
}) {
  let password, repeated;
  try {
    write(
      '1. Redefinir senha\n2. Alterar e-mail\n3. Consultar usuário\n4. Sair'
    );
    const choice = (await prompt('Opção: ')).trim();
    if (choice === '4') return true;
    if (!['1', '2', '3'].includes(choice)) fail('Opção inválida.');
    const user = await resolveUser(
      client,
      await prompt('E-mail atual ou user_id: ')
    );
    if (!UUID.test(user.id) || !validEmail(user.email))
      fail('Identidade Auth não suportada; ação bloqueada.');
    const profile = await readProfile(client, user);
    write(
      `User ID: ${safeDisplay(user.id)}\nE-mail atual: ${safeDisplay(user.email)}`
    );
    if (choice === '3') {
      write('Usuário Auth e vínculo WACRM encontrados. Nenhuma alteração.');
      return true;
    }
    if (profile.email !== user.email)
      fail(
        'Auth/perfil já divergentes; corrigir sincronização antes da manutenção.'
      );
    if (choice === '1') {
      if (
        (await prompt(`Confirme digitando RESET ${user.id}: `)) !==
        `RESET ${user.id}`
      )
        fail('Confirmação recusada; nenhuma alteração.');
      password = await prompt('Nova senha (mínimo 8 caracteres): ', {
        hidden: true,
      });
      if (password.length < 8)
        fail('Senha deve ter pelo menos 8 caracteres; nenhuma alteração.');
      repeated = await prompt('Repita a nova senha: ', { hidden: true });
      if (password !== repeated)
        fail('Senhas não coincidem; nenhuma alteração.');
      await updateTarget(client, user, profile, { password });
    } else {
      const email = (await prompt('Novo e-mail: ')).trim().toLowerCase();
      if (!validEmail(email)) fail('Novo e-mail inválido; nenhuma alteração.');
      if (email === user.email.toLowerCase())
        fail('E-mail já é o atual; nenhuma alteração.');
      write(
        `Novo e-mail: ${safeDisplay(email)} (alteração administrativa, sem confirmação por e-mail).`
      );
      if (
        (await prompt(`Confirme digitando ALTERAR ${user.id}: `)) !==
        `ALTERAR ${user.id}`
      )
        fail('Confirmação recusada; nenhuma alteração.');
      await updateTarget(client, user, profile, { email });
    }
    write(
      'SUCESSO: operação Auth confirmada e perfil/vínculo WACRM verificados.'
    );
    return true;
  } catch (error) {
    write(
      error instanceof SupportError
        ? error.message
        : 'ERRO: leitura administrativa falhou; nenhum resultado confirmado. Não repetir automaticamente.'
    );
    return false;
  } finally {
    password = undefined;
    repeated = undefined;
  }
}

async function main() {
  try {
    if (process.argv.length !== 2)
      fail('Não aceita argumentos. Use apenas o menu interativo.');
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      fail('Exige terminal TTY privado; não aceita pipe/redirecionamento.');
    const client = createOperationalClient();
    process.exitCode = (await runSupport({ client })) ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${error instanceof SupportError ? error.message : 'ERRO administrativo sanitizado.'}\n`
    );
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
