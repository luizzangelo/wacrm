import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const checker = readFileSync(new URL('./21g_runtime_check.mjs', import.meta.url), 'utf8');
function simulate(cachedStatus, originStatus) {
  // Replace only the secret-file import. Fetch is fully mocked before executing
  // the exact checker body; no credential read or network request can occur.
  const body = checker.replace("import {readFileSync} from 'node:fs';",
    "const readFileSync=()=> 'offline-placeholder';");
  assert.notEqual(body, checker);
  const setup = `
    process.env.NEXT_PUBLIC_SUPABASE_URL='https://awganmhowivedfocwzjy.supabase.co';
    const avatar=Buffer.from('offline-avatar-fixture');
    globalThis.fetch=async (url,options)=> {
      if(options.method!=='GET')throw new Error('No mutations allowed');
      if(url.includes('/rest/v1/profiles'))return Response.json([
        {avatar_url:'/api/storage/avatars/account-fixture/avatar-fixture.jpg'}
      ]);
      if(url.includes('/object/authenticated/'))return new Response(avatar,{status:200});
      if(url.includes('/object/public/')) {
        if(Object.keys(options.headers).length)throw new Error('Anonymous request must omit credentials');
        const status=url.includes('cacheNonce=')?${originStatus}:${cachedStatus};
        return new Response(status===200?avatar:'not accessible',{
          status,headers:{'cf-cache-status':status===200?'HIT':'MISS'}
        });
      }
      throw new Error('Unexpected route');
    };
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    input:setup+body, encoding:'utf8', timeout:10000,
    env:{PATH:process.env.PATH, NODE_ENV:'test'},
  });
  assert.ifError(result.error);
  const output = JSON.parse(result.stdout.trim());
  assert.ok(!result.stdout.includes('offline-placeholder'));
  assert.ok(!result.stdout.includes('account-fixture'));
  assert.ok(!result.stdout.includes('avatar-fixture.jpg'));
  return {result,output};
}

test('private origin and inaccessible exact legacy URL pass', () => {
  const {result,output}=simulate(400,400);
  assert.equal(result.status,0);
  assert.equal(output.anonymous_public_http,400);
  assert.equal(output.anonymous_uncached_http,400);
  assert.equal(output.private_reference,true);
});

test('legacy CDN cache exposure fails even when private origin denies access', () => {
  const {result,output}=simulate(200,400);
  assert.equal(result.status,1);
  assert.equal(output.anonymous_cache_status,'HIT');
  assert.equal(output.anonymous_body_matches_avatar,true);
  assert.equal(output.anonymous_uncached_http,400);
});

test('uncached anonymous origin exposure fails even when exact URL denies access', () => {
  const {result,output}=simulate(400,200);
  assert.equal(result.status,1);
  assert.equal(output.anonymous_public_http,400);
  assert.equal(output.anonymous_uncached_http,200);
});
