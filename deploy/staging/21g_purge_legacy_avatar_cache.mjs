// Scoped CDN invalidation only: never deletes/moves/updates the stored object.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(base).hostname,'awganmhowivedfocwzjy.supabase.co');
const key=readFileSync('/run/secrets/wacrm_staging_supabase_service_role','utf8').trim();
const headers={apikey:key,Authorization:`Bearer ${key}`};
const rows=await fetch(base+'/rest/v1/profiles?select=avatar_url&avatar_url=not.is.null',{headers}).then(r=>r.json());
assert.equal(rows.length,1);
const prefix='/api/storage/avatars/';assert.ok(rows[0].avatar_url.startsWith(prefix));
const path=rows[0].avatar_url.slice(prefix.length);assert.ok(path && !path.includes('..'));
const bucket=await fetch(base+'/storage/v1/bucket/avatars',{headers}).then(r=>r.json());
assert.equal(bucket.public,false);
// /cdn is the documented cache API, NOT /object. Exact one existing avatar.
const response=await fetch(base+'/storage/v1/cdn/avatars/'+path,{
  method:'DELETE',headers,redirect:'error',signal:AbortSignal.timeout(15000),
});
console.log(JSON.stringify({operation:'purge_single_legacy_avatar_CDN_cache',http:response.status,stored_object_deleted:false,bytes_modified:false}));
if(!response.ok)process.exitCode=1;
