// Native PG17 two-session tests. No network, application or external worker.
import fs from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.env.WACRM_RESTORE_ROOT;
if(!root?.startsWith('/')) throw Error('Explicit WACRM_RESTORE_ROOT required');
const lab=root+'/restore-lab',state=JSON.parse(fs.readFileSync(lab+'/lab-state.json'));
const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',PGPASSFILE:lab+'/local-pgpass'};
const clone='wacrm_21g_concurrency_'+randomBytes(5).toString('hex');
const args=database=>['-X','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',state.socket,'-p',String(state.port),'-U',state.user,'-d',database];
function run(exe,argv,input){const r=spawnSync(exe,argv,{input,env,encoding:'utf8',maxBuffer:8*1024*1024});if(r.status!==0)throw Error(r.stderr);return r.stdout;}
const query=(sql,db=clone)=>run(lab+'/runtime/bin/psql',args(db),sql);
function session(sql){return new Promise((resolve,reject)=>{
  const child=spawn(lab+'/runtime/bin/psql',args(clone),{env});let stdout='',stderr='';
  child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',reject);
  child.on('close',code=>resolve({code,stdout,sqlstate:stderr.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1]??null}));child.stdin.end(sql);
});}
const A='f2100000-0000-4000-8000-000000000001',B='f2100000-0000-4000-8000-000000000002',C='f2100000-0000-4000-8000-000000000003';
const actor=(id,sql)=>`BEGIN; SET LOCAL statement_timeout='10s'; SELECT set_config('request.jwt.claim.sub','${id}',true),set_config('request.jwt.claims','{"sub":"${id}","role":"authenticated"}',true); SET LOCAL ROLE authenticated; ${sql}; COMMIT;`;
const json=sql=>JSON.parse(query(sql).trim());
const observations=[];let started=false,created=false,before;
const fingerprint=()=>query(`BEGIN READ ONLY; SET LOCAL TIME ZONE 'UTC'; ${fs.readFileSync(root+'/data-check-query.sql','utf8')} COMMIT;`,state.database);
try {
  run('/usr/bin/sandbox-exec',['-p',state.policy,lab+'/runtime/bin/pg_ctl','start','-D',state.data,'-l',lab+'/server.log','-o',state.options,'-w','-t','30']);started=true;
  before=fingerprint();
  query(`CREATE DATABASE ${clone} TEMPLATE ${state.database};`,'postgres');created=true;
  query(`BEGIN; ${fs.readFileSync(new URL('../migrations/20260918004200_saas_tenant_boundaries_and_bootstrap.sql',import.meta.url),'utf8')} COMMIT;`);
  query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('${A}','21g-a@example.invalid','{}'),('${B}','21g-b@example.invalid','{}'),('${C}','21g-c@example.invalid','{}');
    INSERT INTO public.account_invitations(account_id,role,token_hash,expires_at) SELECT account_id,'agent','21g-concurrent-invite',now()+interval '1 hour' FROM profiles WHERE user_id='${A}';`);
  const invites=await Promise.all([session(actor(C,"SELECT public.redeem_invitation('21g-concurrent-invite')")),session(actor(C,"SELECT public.redeem_invitation('21g-concurrent-invite')"))]);
  assert.equal(invites.filter(x=>x.code===0).length,1);assert.equal(invites.filter(x=>x.sqlstate==='22023').length,1);
  assert.equal(json(`SELECT jsonb_build_object('valid',p.account_id=q.account_id AND p.account_role='agent','consumed',i.accepted_at IS NOT NULL AND i.accepted_by_user_id='${C}') FROM profiles p JOIN profiles q ON q.user_id='${A}' JOIN account_invitations i ON i.token_hash='21g-concurrent-invite' WHERE p.user_id='${C}';`).valid,true);
  observations.push({case:'invite_concurrent_single_use',success:1,denied:1});
  const accounts=json(`SELECT jsonb_object_agg(user_id,account_id) FROM profiles WHERE user_id IN ('${A}','${B}');`);
  const events=[];
  for(const [user,suffix] of [[A,'A'],[B,'B']]){
    const account=accounts[user];
    const contact=query(`INSERT INTO contacts(user_id,account_id,phone,name) VALUES('${user}','${account}','1555000000${suffix==='A'?1:2}','Synthetic ${suffix}') RETURNING id;`).trim().split('\n')[0];
    const conversation=query(`INSERT INTO conversations(user_id,account_id,contact_id) VALUES('${user}','${account}','${contact}') RETURNING id;`).trim().split('\n')[0];
    const deal=query(`INSERT INTO deals(user_id,account_id,pipeline_id,contact_id,conversation_id) SELECT '${user}','${account}',id,'${contact}','${conversation}' FROM pipelines WHERE account_id='${account}' LIMIT 1 RETURNING id;`).trim().split('\n')[0];
    const attribution=query(`INSERT INTO meta_ad_attributions(account_id,contact_id,conversation_id,ctwa_clid,source_type) VALUES('${account}','${contact}','${conversation}','synthetic-21g-${suffix}','ad') RETURNING id;`).trim().split('\n')[0];
    const event=query(`INSERT INTO meta_conversion_events(account_id,deal_id,attribution_id,event_name,event_id,event_time,status,attempts) VALUES('${account}','${deal}','${attribution}','QualifiedLead','synthetic-21g-${suffix}',now(),'pending',0) RETURNING id;`).trim().split('\n')[0];
    events.push({account,event});
  }
  const claim=({account,event})=>`BEGIN; SET LOCAL statement_timeout='10s'; WITH c AS (UPDATE meta_conversion_events SET status='sending',attempts=1 WHERE id='${event}' AND account_id='${account}' AND status='pending' AND attempts=0 RETURNING id) SELECT jsonb_build_object('claimed',count(*)) FROM c; COMMIT;`;
  const claims=await Promise.all([session(claim(events[0])),session(claim(events[0])),session(claim(events[1]))]);
  for(const r of claims)assert.equal(r.code,0);
  const count=r=>JSON.parse(r.stdout.split('\n').find(x=>x.startsWith('{'))).claimed;
  assert.equal(count(claims[0])+count(claims[1]),1);assert.equal(count(claims[2]),1);
  query(`UPDATE meta_conversion_events SET status='failed' WHERE id='${events[0].event}' AND account_id='${events[0].account}';`);
  assert.equal(json(`SELECT jsonb_build_object('status',status,'attempts',attempts) FROM meta_conversion_events WHERE id='${events[1].event}';`).status,'sending');
  observations.push({case:'concurrent_claim_A_once_B_independent',claims_A:1,claims_B:1,failure_A_does_not_change_B:true});
  const roles=await Promise.all([session(actor(A,`SELECT public.transfer_account_ownership('${C}')`)),session(actor(A,`SELECT public.remove_account_member('${C}')`))]);
  assert.equal(roles.filter(x=>x.code===0).length,1);
  assert.equal(roles.filter(x=>['42501','22023'].includes(x.sqlstate)).length,1);
  const owner=json(`SELECT jsonb_build_object('owners',count(*) FILTER(WHERE p.account_role='owner'),'matching',count(*) FILTER(WHERE p.account_role='owner' AND p.user_id=a.owner_user_id)) FROM accounts a JOIN profiles p ON p.account_id=a.id WHERE a.id='${accounts[A]}' GROUP BY a.id;`);
  assert.deepEqual(owner,{owners:1,matching:1});
  observations.push({case:'ownership_transfer_vs_member_removal',success:1,denied:1,one_owner:true,pointer_consistent:true});
  assert.equal(fingerprint(),before);
  fs.writeFileSync(root+'/saas-concurrency-21g.json',JSON.stringify({observations,original_restore_unchanged:true,external_integrations:false,pass:true},null,2),{mode:0o600});
  console.log(JSON.stringify({observations:observations.length,pass:true,original_restore_unchanged:true,external_integrations:false}));
} finally {
  if(created)query(`DROP DATABASE ${clone};`,'postgres');
  if(started){assert.equal(fingerprint(),before);run('/usr/bin/sandbox-exec',['-p',state.policy,lab+'/runtime/bin/pg_ctl','stop','-D',state.data,'-m','fast','-w','-t','30']);console.log('Isolated concurrency clone removed; historical lab stopped.');}
}
