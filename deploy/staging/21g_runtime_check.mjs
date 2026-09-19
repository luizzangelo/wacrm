// Read-only runtime preservation check. Never prints paths, PII or credentials.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base=process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(base).hostname,'awganmhowivedfocwzjy.supabase.co');
const key=readFileSync('/run/secrets/wacrm_staging_supabase_service_role','utf8').trim();
const headers={apikey:key,Authorization:`Bearer ${key}`};
const get=async(path,authenticated=true)=>fetch(base+path,{method:'GET',headers:authenticated?headers:{},redirect:'error',signal:AbortSignal.timeout(15000)});
const profiles=await get('/rest/v1/profiles?select=avatar_url&avatar_url=not.is.null');
assert.equal(profiles.status,200);
const rows=await profiles.json();assert.equal(rows.length,1);
const url=new URL(rows[0].avatar_url,'https://crm.luizangelo.com.br');
const path=url.pathname.replace(/^\/api\/storage\/avatars\//,'').replace(/^\/storage\/v1\/object\/(public|authenticated|sign)\/avatars\//,'');
assert.notEqual(path,url.pathname);
const authenticated=await get('/storage/v1/object/authenticated/avatars/'+path);
assert.equal(authenticated.status,200);
const bytes=Buffer.from(await authenticated.arrayBuffer());assert.ok(bytes.length>0);
const publicRead=await get('/storage/v1/object/public/avatars/'+path,false);
const publicBytes=publicRead.ok?Buffer.from(await publicRead.arrayBuffer()):null;
const uncachedPublicRead=await get('/storage/v1/object/public/avatars/'+path+'?cacheNonce='+Date.now(),false);
console.log(JSON.stringify({avatar_count:rows.length,avatar_bytes:bytes.length,avatar_sha256:createHash('sha256').update(bytes).digest('hex'),authenticated_http:authenticated.status,anonymous_public_http:publicRead.status,anonymous_body_matches_avatar:publicBytes?.equals(bytes)??false,anonymous_cache_status:publicRead.headers.get('cf-cache-status'),anonymous_cache_control:publicRead.headers.get('cache-control'),anonymous_cache_age:publicRead.headers.get('age'),anonymous_uncached_http:uncachedPublicRead.status,private_reference:url.pathname.startsWith('/api/storage/')}));
// A private bucket flag alone does not prove that a legacy cached URL is inaccessible.
assert.ok(!publicRead.ok && !uncachedPublicRead.ok,'Legacy anonymous URL is still accessible');
