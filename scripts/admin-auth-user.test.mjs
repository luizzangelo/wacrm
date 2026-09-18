import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import {
  PROJECT_REF,
  guardedFetch,
  resolveUser,
  runSupport,
  terminalPrompt,
  validateEnvironment,
} from './admin-auth-user.mjs';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const PASSWORD = 'Secret-test-only-123';
const KEY = `header.${Buffer.from(JSON.stringify({ ref: PROJECT_REF, role: 'service_role' })).toString('base64url')}.signature`;
const ENV = { NEXT_PUBLIC_SUPABASE_URL: `https://${PROJECT_REF}.supabase.co` };

function fixture({
  sync = true,
  duplicate = false,
  missing = false,
  failure = false,
  drift = false,
} = {}) {
  const users = new Map([
    [A, { id: A, email: 'a@example.test' }],
    [B, { id: B, email: 'b@example.test' }],
  ]);
  const profiles = new Map(
    [...users].map(([id, user]) => [
      id,
      {
        id: `profile-${id}`,
        user_id: id,
        email: user.email,
        account_id: `account-${id}`,
        account_role: 'owner',
      },
    ])
  );
  const calls = [];
  const client = {
    auth: {
      admin: {
        async listUsers() {
          return {
            data: {
              users: missing
                ? []
                : [
                    ...users.values(),
                    ...(duplicate
                      ? [
                          {
                            id: '00000000-0000-4000-8000-000000000003',
                            email: users.get(A).email,
                          },
                        ]
                      : []),
                  ],
            },
            error: null,
          };
        },
        async getUserById(id) {
          return {
            data: {
              user: missing
                ? null
                : {
                    ...users.get(id),
                    ...(drift ? { email: 'changed@example.test' } : {}),
                  },
            },
            error: null,
          };
        },
        async updateUserById(id, attrs) {
          calls.push({ id, fields: Object.keys(attrs) });
          if (failure) throw new Error(`${KEY} ${PASSWORD}`);
          if (attrs.email) {
            users.get(id).email = attrs.email;
            if (sync) profiles.get(id).email = attrs.email;
          }
          return { data: { user: { ...users.get(id) } }, error: null };
        },
      },
    },
    from(table) {
      assert.equal(table, 'profiles');
      return {
        select() {
          return {
            eq(field, id) {
              assert.equal(field, 'user_id');
              return {
                async single() {
                  return { data: { ...profiles.get(id) }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, users, profiles, calls };
}

async function scenario(f, answers) {
  const output = [],
    prompts = [];
  const ok = await runSupport({
    client: f.client,
    write: (text) => output.push(text),
    prompt: async (label, options) => {
      prompts.push({ label, options });
      assert.ok(answers.length);
      return answers.shift();
    },
  });
  const printed = JSON.stringify({ output, prompts });
  assert.ok(!printed.includes(PASSWORD));
  assert.ok(!printed.includes(KEY));
  return { ok, output: output.join('\n'), prompts };
}

test('accepts only approved project and project-bound service role', () => {
  assert.equal(validateEnvironment(ENV, KEY), ENV.NEXT_PUBLIC_SUPABASE_URL);
  for (const url of [
    'https://zyqbgrrpedzxfcwhlfoa.supabase.co',
    'http://awganmhowivedfocwzjy.supabase.co',
    `${ENV.NEXT_PUBLIC_SUPABASE_URL}/other`,
    `${ENV.NEXT_PUBLIC_SUPABASE_URL}?secret=bad`,
  ]) {
    assert.throws(
      () => validateEnvironment({ SUPABASE_URL: url }, KEY),
      /Projeto bloqueado/
    );
  }
  assert.throws(() =>
    validateEnvironment(
      { ...ENV, SUPABASE_URL: 'https://wrong.supabase.co' },
      KEY
    )
  );
  for (const claims of [
    { ref: 'zyqbgrrpedzxfcwhlfoa', role: 'service_role' },
    { ref: PROJECT_REF, role: 'anon' },
    { ref: PROJECT_REF, role: 'service_role', exp: 1 },
  ]) {
    const key = `a.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.b`;
    assert.throws(() => validateEnvironment(ENV, key), /Credencial bloqueada/);
  }
  assert.throws(() => validateEnvironment(ENV, 'sb_secret_test'));
});

test('missing and ambiguous users never mutate', async () => {
  for (const opts of [{ missing: true }, { duplicate: true }]) {
    const f = fixture(opts);
    assert.equal((await scenario(f, ['1', 'a@example.test'])).ok, false);
    assert.equal(f.calls.length, 0);
  }
});

test('resolves unique email or exact UUID; inspection is read-only', async () => {
  const f = fixture();
  assert.equal((await resolveUser(f.client, 'A@example.test')).id, A);
  assert.equal((await resolveUser(f.client, B)).id, B);
  assert.equal((await scenario(f, ['3', A])).ok, true);
  assert.equal(f.calls.length, 0);
});

test('scans later pages instead of assuming first match is unique', async () => {
  const users = Array.from({ length: 200 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    email: i ? `${i}@example.test` : 'a@example.test',
  }));
  const pages = [];
  const client = {
    auth: {
      admin: {
        async listUsers({ page }) {
          pages.push(page);
          return {
            data: {
              users:
                page === 1
                  ? users
                  : [
                      {
                        id: '00000000-0000-4000-8000-000000000201',
                        email: 'a@example.test',
                      },
                    ],
            },
          };
        },
      },
    },
  };
  await assert.rejects(resolveUser(client, 'a@example.test'), /Mais de um/);
  assert.deepEqual(pages, [1, 2]);
});

test('rejects short or mismatched passwords and unconfirmed changes', async () => {
  for (const answers of [
    ['1', A, `RESET ${A}`, 'short'],
    ['1', A, `RESET ${A}`, PASSWORD, 'different'],
    ['1', A, 'no'],
  ]) {
    const f = fixture();
    assert.equal((await scenario(f, answers)).ok, false);
    assert.equal(f.calls.length, 0);
  }
});

test('password prompts hidden; only A updated once and B unchanged', async () => {
  const f = fixture();
  const beforeB = JSON.stringify([f.users.get(B), f.profiles.get(B)]);
  const result = await scenario(f, ['1', A, `RESET ${A}`, PASSWORD, PASSWORD]);
  assert.equal(result.ok, true);
  assert.deepEqual(f.calls, [{ id: A, fields: ['password'] }]);
  assert.equal(JSON.stringify([f.users.get(B), f.profiles.get(B)]), beforeB);
  assert.equal(result.prompts.filter((p) => p.options?.hidden).length, 2);
});

test('rejects invalid email before update', async () => {
  const f = fixture();
  assert.equal((await scenario(f, ['2', A, 'invalid-email'])).ok, false);
  assert.equal(f.calls.length, 0);
});

test('email sync verified without any profile write or B update', async () => {
  const f = fixture();
  const beforeB = JSON.stringify([f.users.get(B), f.profiles.get(B)]);
  assert.equal(
    (await scenario(f, ['2', A, 'new@example.test', `ALTERAR ${A}`])).ok,
    true
  );
  assert.equal(f.users.get(A).email, 'new@example.test');
  assert.equal(f.profiles.get(A).email, 'new@example.test');
  assert.equal(JSON.stringify([f.users.get(B), f.profiles.get(B)]), beforeB);
  assert.deepEqual(f.calls, [{ id: A, fields: ['email'] }]);
});

test('email sync failure reports partial mutation, not success or retry', async () => {
  const f = fixture({ sync: false });
  const result = await scenario(f, [
    '2',
    A,
    'new@example.test',
    `ALTERAR ${A}`,
  ]);
  assert.equal(result.ok, false);
  assert.match(result.output, /ERRO pós-operação/);
  assert.doesNotMatch(result.output, /SUCESSO/);
  assert.equal(f.calls.length, 1);
});

test('provider exception sanitized and update is never retried', async () => {
  const f = fixture({ failure: true });
  assert.equal(
    (await scenario(f, ['1', A, `RESET ${A}`, PASSWORD, PASSWORD])).ok,
    false
  );
  assert.equal(f.calls.length, 1);
});

test('changed target after confirmation blocks mutation', async () => {
  const f = fixture({ drift: true });
  assert.equal(
    (await scenario(f, ['1', A, `RESET ${A}`, PASSWORD, PASSWORD])).ok,
    false
  );
  assert.equal(f.calls.length, 0);
});

test('transport restricts origin, paths, method, redirects; one attempt even on failure', async () => {
  let calls = 0;
  const fetch = guardedFetch(async (_input, init) => {
    calls++;
    assert.equal(init.redirect, 'error');
    throw new Error(`${PASSWORD} ${KEY}`);
  });
  await assert.rejects(
    fetch(`${ENV.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${A}`, {
      method: 'PUT',
    }),
    (error) => !error.message.includes(KEY) && !error.message.includes(PASSWORD)
  );
  assert.equal(calls, 1);
  for (const [url, method] of [
    ['https://zyqbgrrpedzxfcwhlfoa.supabase.co/auth/v1/admin/users', 'GET'],
    [`${ENV.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles`, 'PATCH'],
    [`${ENV.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${A}`, 'DELETE'],
  ]) {
    await assert.rejects(fetch(url, { method }));
  }
  assert.equal(calls, 1);
});

function tty() {
  const input = new EventEmitter();
  input.isTTY = true;
  input.isPaused = () => true;
  input.setRawMode = (value) => {
    input.isRaw = value;
  };
  input.resume = () => {};
  input.pause = () => {};
  const output = {
    isTTY: true,
    text: '',
    write(value) {
      this.text += value.toString();
    },
  };
  return { input, output, signals: new EventEmitter() };
}

test('real hidden prompt does not echo password and restores raw mode/listeners', async () => {
  const terminal = tty();
  const answer = terminalPrompt('Senha: ', { ...terminal, hidden: true });
  terminal.input.emit('data', Buffer.from(`${PASSWORD}\r`));
  assert.equal(await answer, PASSWORD);
  assert.equal(terminal.output.text, 'Senha: \n');
  assert.equal(terminal.input.isRaw, false);
  assert.equal(terminal.input.listenerCount('data'), 0);
  assert.equal(terminal.signals.listenerCount('SIGTERM'), 0);
});

test('hidden prompt cancellation, multiline paste and non-TTY fail closed', async () => {
  for (const action of ['ctrlc', 'sigterm', 'multiline']) {
    const terminal = tty();
    const answer = terminalPrompt('Senha: ', { ...terminal, hidden: true });
    if (action === 'sigterm') terminal.signals.emit('SIGTERM');
    else
      terminal.input.emit(
        'data',
        Buffer.from(action === 'ctrlc' ? '\x03' : `${PASSWORD}\rnext`)
      );
    await assert.rejects(answer);
    assert.equal(terminal.input.isRaw, false);
    assert.ok(!terminal.output.text.includes(PASSWORD));
  }
  await assert.rejects(
    terminalPrompt('Senha: ', {
      input: { isTTY: false },
      output: { isTTY: true },
    })
  );
});

test('CLI refuses arguments or pipes without printing arguments or loading credentials', () => {
  for (const args of [[PASSWORD], []]) {
    const result = spawnSync(
      process.execPath,
      ['scripts/admin-auth-user.mjs', ...args],
      {
        encoding: 'utf8',
        env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: KEY },
      }
    );
    assert.equal(result.status, 1);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(PASSWORD));
    assert.ok(!`${result.stdout}${result.stderr}`.includes(KEY));
  }
});

test('SDK oficial envia a senha apenas no PUT Auth aprovado, uma vez, sem profile write', async () => {
  let putCount = 0;
  const user = { id: A, email: 'a@example.test' };
  const profile = {
    id: 'profile-a',
    user_id: A,
    email: user.email,
    account_id: 'account-a',
    account_role: 'owner',
  };
  const transport = guardedFetch(async (input, init) => {
    const url = new URL(input);
    if (init.method === 'PUT') {
      putCount++;
      assert.equal(url.pathname, `/auth/v1/admin/users/${A}`);
      assert.deepEqual(JSON.parse(init.body), { password: PASSWORD });
    } else assert.equal(init.method, 'GET');
    if (url.pathname === '/rest/v1/profiles') {
      assert.equal(url.searchParams.get('user_id'), `eq.${A}`);
      return Response.json(profile);
    }
    return Response.json(user);
  });
  const client = createClient(ENV.NEXT_PUBLIC_SUPABASE_URL, KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: transport },
  });
  assert.equal(
    (await scenario({ client }, ['1', A, `RESET ${A}`, PASSWORD, PASSWORD])).ok,
    true
  );
  assert.equal(putCount, 1);
});

test('missing/wrong profile blocks action before Auth update', async () => {
  for (const mode of ['missing', 'wrong-user']) {
    const f = fixture();
    if (mode === 'missing') f.profiles.delete(A);
    else f.profiles.get(A).user_id = B;
    assert.equal((await scenario(f, ['1', A])).ok, false);
    assert.equal(f.calls.length, 0);
  }
});

test('wrong Auth mutation response or changed membership cannot report success', async () => {
  for (const mode of ['wrong-response', 'changed-membership']) {
    const f = fixture();
    const update = f.client.auth.admin.updateUserById;
    f.client.auth.admin.updateUserById = async (...args) => {
      const result = await update(...args);
      if (mode === 'wrong-response') result.data.user.id = B;
      else f.profiles.get(A).account_id = 'different-account';
      return result;
    };
    const result = await scenario(f, [
      '1',
      A,
      `RESET ${A}`,
      PASSWORD,
      PASSWORD,
    ]);
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.output, /SUCESSO/);
    assert.equal(f.calls.length, 1);
  }
});

test('SDK transport logging is sanitized even when raw exception contains credentials', async () => {
  let attempts = 0;
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.map(String).join(' '));
  try {
    const client = createClient(ENV.NEXT_PUBLIC_SUPABASE_URL, KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: guardedFetch(async () => {
          attempts++;
          throw new Error(`${KEY} ${PASSWORD}`);
        }),
      },
    });
    const { error } = await client.auth.admin.updateUserById(A, {
      password: PASSWORD,
    });
    assert.ok(error);
    assert.equal(attempts, 1);
    assert.ok(logged.length);
    assert.ok(!logged.join('\n').includes(KEY));
    assert.ok(!logged.join('\n').includes(PASSWORD));
  } finally {
    console.error = originalError;
  }
});
