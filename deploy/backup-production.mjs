// Explicit one-shot DR capture. No schedule, deletion, restore, or source mutation.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const project = 'awganmhowivedfocwzjy';
const accountHome = '/Users/luizangelo';
const backupBase = accountHome + '/Backups/wacrm/production';
const pgBin = '/Library/PostgreSQL/17/bin/';
const serviceFile = accountHome + '/.pg_service.conf';
// libpq reads the password file; this program NEVER reads its contents.
const passwordFile = accountHome + '/.pgpass';
process.umask(0o077);
for (const file of [serviceFile, passwordFile]) {
  assert.equal(fs.statSync(file).mode & 0o077, 0, 'Unsafe connection-file permissions');
}
const service = fs.readFileSync(serviceFile, 'utf8')
  .split(/^\[wacrm_staging\]\s*$/m)[1]?.split(/^\[/m)[0];
assert.ok(service, 'Missing approved legacy libpq service');
const config = Object.fromEntries(service.split('\n').filter(x => /^\w+\s*=/.test(x))
  .map(x => { const i = x.indexOf('='); return [x.slice(0,i).trim(),x.slice(i+1).trim()]; }));
assert.equal(config.user, 'postgres.' + project, 'Unexpected source project');
assert.equal(config.host, 'aws-0-us-east-1.pooler.supabase.com');
assert.equal(config.port, '5432');
assert.equal(config.dbname, 'postgres');
assert.ok(['require','verify-full'].includes(config.sslmode));
assert.ok(!config.password, 'Do not embed passwords in the service file');

const timestamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
fs.mkdirSync(backupBase, { recursive:true, mode:0o700 });
const destination = path.join(backupBase,timestamp);
fs.mkdirSync(destination, { mode:0o700 }); // Existing destination is an error, never overwritten.
console.log(JSON.stringify({event:'backup_started',destination,project}));
const pgEnv = {
  PATH: process.env.PATH, LANG:'C', PGTZ:'UTC',
  PGSERVICEFILE:serviceFile, PGPASSFILE:passwordFile, PGCONNECT_TIMEOUT:'20',
  PGOPTIONS:'-c default_transaction_read_only=on',
};
function run(command,args,{input,env=pgEnv,maxBytes=64*1024*1024}={}) {
  return new Promise((resolve,reject) => {
    const child=spawn(command,args,{env,stdio:['pipe','pipe','pipe']});
    const chunks=[]; let count=0;
    child.stdout.on('data',chunk => { count+=chunk.length; if(count>maxBytes)child.kill(); else chunks.push(chunk); });
    // Drain stderr, but do not expose/store connection errors containing remote data.
    child.stderr.on('data',()=>{});
    child.on('error',()=>reject(new Error('Command could not start: '+path.basename(command))));
    child.on('close',code => code===0 && count<=maxBytes
      ? resolve(Buffer.concat(chunks).toString('utf8'))
      : reject(new Error('Command failed: '+path.basename(command)+'; code='+code)));
    child.stdin.on('error',()=>{});
    child.stdin.end(input);
  });
}
async function query(sql) {
  return JSON.parse((await run(pgBin+'psql',[
    '-X','--no-password','--tuples-only','--no-align','--dbname=service=wacrm_staging',
    '--set=ON_ERROR_STOP=1','--command',sql,
  ])).trim());
}
const inventorySql = `SELECT jsonb_build_object(
 'server_version',current_setting('server_version'),
 'auth_users',(SELECT count(*) FROM auth.users),
 'auth_identities',(SELECT count(*) FROM auth.identities),
 'migrations',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'events',(SELECT count(*) FROM public.meta_conversion_events),
 'pending',(SELECT count(*) FROM public.meta_conversion_events WHERE status='pending'),
 'sending',(SELECT count(*) FROM public.meta_conversion_events WHERE status='sending'),
 'objects',coalesce((SELECT jsonb_agg(jsonb_build_object('bucket',bucket_id,'name',name,
 'metadata',metadata,'updated_at',updated_at) ORDER BY bucket_id,name) FROM storage.objects),'[]'::jsonb),
 'buckets',(SELECT jsonb_agg(jsonb_build_object('id',id,'public',public) ORDER BY id) FROM storage.buckets))`;
const save=(name,content)=>fs.writeFileSync(path.join(destination,name),content,{mode:0o600,flag:'wx'});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashFile=name=>digest(fs.readFileSync(path.join(destination,name)));
try {
  const before=await query(inventorySql);
  assert.equal(before.pending,0); assert.equal(before.sending,0);
  assert.equal(before.buckets.length,3);
  assert.ok(before.buckets.every(x=>!x.public));
  save('origin-before.json',JSON.stringify(before,null,2));
  const started=new Date().toISOString();
  await run(pgBin+'pg_dump',[
    '--dbname=service=wacrm_staging','--no-password','--format=custom',
    '--file='+path.join(destination,'database.dump'),
  ]);
  fs.chmodSync(path.join(destination,'database.dump'),0o600);
  assert.ok(fs.statSync(path.join(destination,'database.dump')).size>0);
  save('database.dump.sha256',hashFile('database.dump')+'  database.dump\n');
  const toc=await run(pgBin+'pg_restore',['--list',path.join(destination,'database.dump')]);
  for(const [schema,table] of [
    ['auth','users'],['auth','identities'],['storage','buckets'],['storage','objects'],
    ['supabase_migrations','schema_migrations'],['public','accounts'],['public','profiles'],
    ['public','meta_conversion_events'],['public','whatsapp_config'],
  ]) assert.ok(toc.includes('TABLE DATA '+schema+' '+table+' '),'Missing critical archive relation');
  assert.ok(toc.includes('wacrm_private'),'Missing 21G private schema');
  save('database.toc',toc);
  await run(pgBin+'pg_restore',[
    '--schema-only','--file='+path.join(destination,'database-schema.sql'),
    path.join(destination,'database.dump'),
  ]);
  fs.chmodSync(path.join(destination,'database-schema.sql'),0o600);
  assert.equal(hashFile('database.dump'),fs.readFileSync(path.join(destination,'database.dump.sha256'),'utf8').split(' ')[0]);

  const exportScript = `
const fs=require('node:fs');const crypto=require('node:crypto');
const base=process.env.NEXT_PUBLIC_SUPABASE_URL;
if(new URL(base).hostname!==${JSON.stringify(project+'.supabase.co')})process.exit(2);
const key=fs.readFileSync('/run/secrets/wacrm_staging_supabase_service_role','utf8').trim();
const objects=${JSON.stringify(before.objects)};
(async()=>{for(const o of objects){
 const parts=[o.bucket,...o.name.split('/')];
 if(parts.some(x=>!x||x==='.'||x==='..'||x.includes('\\\\')))throw new Error('path');
 if(Number(o.metadata?.size)>32*1024*1024)throw new Error('size');
 const r=await fetch(base+'/storage/v1/object/authenticated/'+parts.map(encodeURIComponent).join('/'),{
 headers:{apikey:key,Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw new Error('http'); const b=Buffer.from(await r.arrayBuffer());
 if(b.length>32*1024*1024||Number(o.metadata?.size)!==b.length)throw new Error('size');
 process.stdout.write(JSON.stringify({bucket:o.bucket,name:o.name,bytes:b.length,
 sha256:crypto.createHash('sha256').update(b).digest('hex'),data:b.toString('base64')})+'\\n');
}})().catch(()=>{process.stderr.write('Storage export failed');process.exitCode=1});`;
  const output=await run('ssh',[
    '-o','BatchMode=yes','-o','ConnectTimeout=10','root@5.161.111.81',
    'docker exec -i "$(docker ps --filter label=com.docker.swarm.service.name=wacrm_staging_app --format "{{.ID}}")" node -',
  ],{input:exportScript,env:{PATH:process.env.PATH}});
  const objects=output.trim()?output.trim().split('\n').map(line=>JSON.parse(line)):[];
  assert.equal(objects.length,before.objects.length);
  const seen=new Set(); const storage=[];
  for(const object of objects) {
    const relative='storage/'+object.bucket+'/'+object.name;
    assert.ok(before.objects.some(x=>x.bucket===object.bucket&&x.name===object.name));
    assert.ok(!seen.has(relative)); seen.add(relative);
    const target=path.resolve(destination,relative);
    assert.ok(target.startsWith(destination+'/storage/'));
    assert.ok(!object.name.split('/').some(x=>!x||x==='.'||x==='..'||x.includes('\\')));
    const bytes=Buffer.from(object.data,'base64');
    assert.equal(bytes.length,object.bytes); assert.equal(digest(bytes),object.sha256);
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    fs.writeFileSync(target,bytes,{mode:0o600,flag:'wx'});
    assert.equal(hashFile(relative),object.sha256);
    storage.push({bucket:object.bucket,name:object.name,bytes:object.bytes,sha256:object.sha256});
  }
  save('storage-inventory.json',JSON.stringify(storage,null,2));
  save('storage-objects.sha256',storage.map(x=>x.sha256+'  storage/'+x.bucket+'/'+x.name).join('\n')+'\n');
  const after=await query(inventorySql);
  assert.deepEqual(after.objects,before.objects,'Storage changed during capture');
  assert.deepEqual(after.buckets,before.buckets,'Bucket configuration changed during capture');
  assert.equal(after.events,before.events); assert.equal(after.pending,0); assert.equal(after.sending,0);
  save('origin-after.json',JSON.stringify(after,null,2));
  const result={project,destination,started,finished:new Date().toISOString(),
    dump_bytes:fs.statSync(path.join(destination,'database.dump')).size,
    dump_sha256:hashFile('database.dump'),toc_valid:true,offline_schema_extraction:true,
    auth_users:before.auth_users,auth_identities:before.auth_identities,migrations:before.migrations,
    storage_objects:storage.length,storage_bytes:storage.reduce((n,x)=>n+x.bytes,0),
    meta_events_before:before.events,meta_events_after:after.events,
    source_mutated:false,external_integration_executed:false,
    consistency:'pg_dump snapshot; separate stable Storage inventory; no freeze or coordinated cross-service snapshot',
    operational_secrets_exported:false,
    sensitivity:'Restricted DB/Auth data and encrypted tenant credentials; no Docker/app/libpq secrets exported',
  };
  save('backup-result.json',JSON.stringify(result,null,2));
  const files=['database.dump','database.dump.sha256','database.toc','database-schema.sql',
    'origin-before.json','origin-after.json','storage-inventory.json','storage-objects.sha256',
    'backup-result.json',...storage.map(x=>'storage/'+x.bucket+'/'+x.name)];
  save('checksums.sha256',files.map(name=>hashFile(name)+'  '+name).join('\n')+'\n');
  for(const name of files)assert.equal(fs.statSync(path.join(destination,name)).mode&0o077,0);
  console.log(JSON.stringify(result));
} catch(error) {
  // Retain partial artifacts for diagnosis; never delete and never retry automatically.
  console.error(JSON.stringify({event:'backup_failed',destination,
    error:error instanceof assert.AssertionError?'Validation failed':String(error.message).slice(0,120)}));
  process.exitCode=1;
}
