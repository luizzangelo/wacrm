import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const root=process.env.WACRM_RESTORE_ROOT;
if(!root || !root.startsWith('/')) throw new Error('Explicit absolute WACRM_RESTORE_ROOT required');
if(!process.env.WACRM_AUDIT_CATALOG) throw new Error('Explicit WACRM_AUDIT_CATALOG baseline required');
const lab=root+'/restore-lab';
process.env.WACRM_AUDIT_MIGRATION=new URL('../migrations/20260918004200_saas_tenant_boundaries_and_bootstrap.sql',import.meta.url).pathname;
const state=JSON.parse(fs.readFileSync(lab+'/lab-state.json'));
const source=JSON.parse(fs.readFileSync(process.env.WACRM_AUDIT_CATALOG));
const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',PGPASSFILE:lab+'/local-pgpass'};
function run(exe,args,input){const r=spawnSync(exe,args,{input,env,encoding:'utf8',maxBuffer:20*1024*1024});if(r.status!==0)throw new Error('Local audit failed: '+r.stderr);return r;}
function psql(sql){return run(lab+'/runtime/bin/psql',['-X','-At','-v','ON_ERROR_STOP=1','-h',state.socket,'-p',String(state.port),'-U',state.user,'-d',state.database],sql);}
const a='f1000000-0000-4000-8000-000000000001',b='f1000000-0000-4000-8000-000000000002';
const id=(family,n)=>`f${family}000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ca=id('2',1),cb=id('2',2),va=id('3',1),vb=id('3',2),pa=id('4',1),pb=id('4',2),sa=id('5',1),sb=id('5',2),ma=id('6',1),mb=id('6',2),da=id('7',1),db=id('7',2),ta=id('8',1),tb=id('8',2),fa=id('9',1),fb=id('9',2);
const aa="current_setting('audit.account_a')::uuid",ab="current_setting('audit.account_b')::uuid";
const extra=[['automations','a','name,trigger_type',"'Synthetic automation','manual'"],['flows','b','name,trigger_type',"'Synthetic flow','manual'"],['broadcasts','c','name,template_name',"'Synthetic broadcast','synthetic_template'"]];
let sql=`BEGIN; SET LOCAL TIME ZONE 'UTC';
${process.env.WACRM_AUDIT_MIGRATION ? fs.readFileSync(process.env.WACRM_AUDIT_MIGRATION,'utf8') : ''}
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('${a}','audit-a@example.invalid','{"full_name":"Synthetic Audit A"}'),('${b}','audit-b@example.invalid','{"full_name":"Synthetic Audit B"}');
SELECT set_config('audit.account_a',account_id::text,true) FROM profiles WHERE user_id='${a}';
SELECT set_config('audit.account_b',account_id::text,true) FROM profiles WHERE user_id='${b}';
SELECT jsonb_build_object('case','signup_bootstrap','accounts',count(DISTINCT account_id),'owners',count(*) FILTER(WHERE account_role='owner'),'initial_pipelines',(SELECT count(*) FROM pipelines WHERE account_id IN (${aa},${ab})),'whatsapp_rows',(SELECT count(*) FROM whatsapp_config WHERE account_id IN (${aa},${ab})),'meta_configs',(SELECT count(*) FROM meta_conversion_config WHERE account_id IN (${aa},${ab}))) FROM profiles WHERE user_id IN ('${a}','${b}');
INSERT INTO contacts(id,user_id,account_id,phone,name) VALUES('${ca}','${a}',${aa},'15550000001','Synthetic Contact A'),('${cb}','${b}',${ab},'15550000002','Synthetic Contact B');
INSERT INTO conversations(id,user_id,account_id,contact_id) VALUES('${va}','${a}',${aa},'${ca}'),('${vb}','${b}',${ab},'${cb}');
INSERT INTO pipelines(id,user_id,account_id,name) VALUES('${pa}','${a}',${aa},'Synthetic Pipeline A'),('${pb}','${b}',${ab},'Synthetic Pipeline B');
INSERT INTO pipeline_stages(id,pipeline_id,name,position) VALUES('${sa}','${pa}','Synthetic Initial A',0),('${sb}','${pb}','Synthetic Initial B',0);
INSERT INTO deals(id,user_id,account_id,pipeline_id,contact_id,conversation_id) VALUES('${da}','${a}',${aa},'${pa}','${ca}','${va}'),('${db}','${b}',${ab},'${pb}','${cb}','${vb}');
INSERT INTO messages(id,conversation_id,sender_type,content_text,message_id) VALUES('${ma}','${va}','customer','Synthetic Message A','synthetic-reused-wamid'),('${mb}','${vb}','customer','Synthetic Message B','synthetic-reused-wamid');
INSERT INTO tags(id,user_id,account_id,name) VALUES('${ta}','${a}',${aa},'Synthetic Tag A'),('${tb}','${b}',${ab},'Synthetic Tag B');
INSERT INTO custom_fields(id,user_id,account_id,field_name,field_type) VALUES('${fa}','${a}',${aa},'Synthetic Field A','text'),('${fb}','${b}',${ab},'Synthetic Field B','text');
INSERT INTO whatsapp_config(user_id,account_id,phone_number_id,waba_id,access_token) VALUES('${a}',${aa},'99000000001','99100000001','synthetic-ciphertext-a'),('${b}',${ab},'99000000002','99100000002','synthetic-ciphertext-b');
INSERT INTO meta_conversion_config(account_id,dataset_id,enabled) VALUES(${aa},'99200000001',false),(${ab},'99200000002',false);
INSERT INTO meta_ad_attributions(id,account_id,contact_id,conversation_id,ctwa_clid,source_type,waba_id) VALUES('${id('d',1)}',${aa},'${ca}','${va}','synthetic-ctwa-a','ad','99100000001'),('${id('d',2)}',${ab},'${cb}','${vb}','synthetic-ctwa-b','ad','99100000002');
INSERT INTO meta_conversion_events(id,account_id,deal_id,attribution_id,event_name,event_id,event_time,status) VALUES('${id('e',1)}',${aa},'${da}','${id('d',1)}','LeadSubmitted','synthetic-event-a',now(),'failed'),('${id('e',2)}',${ab},'${db}','${id('d',2)}','LeadSubmitted','synthetic-event-b',now(),'failed');
INSERT INTO deal_loss_events(account_id,deal_id,pipeline_id,lost_stage_id,lost_reason) VALUES(${aa},'${da}','${pa}',(SELECT id FROM pipeline_stages WHERE pipeline_id='${pa}' AND is_lost_stage),'price'),(${ab},'${db}','${pb}',(SELECT id FROM pipeline_stages WHERE pipeline_id='${pb}' AND is_lost_stage),'price');
INSERT INTO notifications(account_id,user_id,title) VALUES(${aa},'${a}','Synthetic notification A'),(${ab},'${b}','Synthetic notification B');
INSERT INTO storage.objects(bucket_id,name) VALUES('chat-media','account-'||${aa}::text||'/synthetic-private-a.txt'),('chat-media','account-'||${ab}::text||'/synthetic-private-b.txt');
${extra.map(([table,family,cols,values])=>`INSERT INTO ${table}(id,user_id,account_id,${cols}) VALUES('${id(family,1)}','${a}',${aa},${values}),('${id(family,2)}','${b}',${ab},${values});`).join('\n')}
SELECT set_config('request.jwt.claim.sub','${a}',true),set_config('request.jwt.claims','{"sub":"${a}","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
`;
function test(name,statement){sql+=`SAVEPOINT audit_case; DO $audit$ DECLARE affected bigint; BEGIN BEGIN ${statement}; GET DIAGNOSTICS affected = ROW_COUNT; SET CONSTRAINTS ALL IMMEDIATE; RAISE NOTICE 'AUDIT %',jsonb_build_object('case','${name}','accepted',true,'rows',affected); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'AUDIT %',jsonb_build_object('case','${name}','accepted',false,'sqlstate',SQLSTATE); END; END $audit$; ROLLBACK TO SAVEPOINT audit_case; RELEASE SAVEPOINT audit_case;\n`;}
for(const [table,key,value] of [['contacts','id',cb],['conversations','id',vb],['messages','id',mb],['pipelines','id',pb],['pipeline_stages','id',sb],['deals','id',db],['tags','id',tb],['custom_fields','id',fb]]){
sql+=`SELECT jsonb_build_object('case','A_cannot_read_B_${table}','visible',count(*)) FROM ${table} WHERE ${key}='${value}';\n`;
test('A_cannot_delete_B_'+table,`DELETE FROM ${table} WHERE ${key}='${value}'`);
}
for(const table of ['whatsapp_config','meta_conversion_config'])sql+=`SELECT jsonb_build_object('case','A_cannot_read_B_${table}','visible',count(*)) FROM ${table} WHERE account_id=${ab};\n`;
if(process.env.WACRM_AUDIT_MIGRATION){
for(const table of ['contacts','conversations','pipelines','deals','tags','custom_fields','whatsapp_config','meta_conversion_config']) {
  sql+=`SELECT jsonb_build_object('case','A_reads_own_${table}','visible',count(*)) FROM ${table} WHERE account_id=${aa};\n`;
  test('A_cannot_delete_B_'+table+'_full',`DELETE FROM ${table} WHERE account_id=${ab}`);
}
for(const [table,column,value] of [['whatsapp_config','status',"'disconnected'"],['meta_conversion_config','enabled','true'],['conversations','status',"'closed'"],['pipelines','name',"'Synthetic Intrusion'"],['deals','value','99'],['tags','name',"'Synthetic Intrusion'"],['custom_fields','field_name',"'Synthetic Intrusion'"]])test('A_cannot_update_B_'+table+'_full',`UPDATE ${table} SET ${column}=${value} WHERE account_id=${ab}`);
test('A_cannot_insert_B_contact',`INSERT INTO contacts(user_id,account_id,phone) VALUES('${a}',${ab},'15550000003')`);
test('A_cannot_insert_B_pipeline',`INSERT INTO pipelines(user_id,account_id,name) VALUES('${a}',${ab},'Synthetic Intrusion')`);
}

if(process.env.WACRM_AUDIT_MIGRATION){
  for(const [table,predicate] of [
    ['accounts',`id=${aa}`],['profiles',`account_id=${aa}`],['messages',`account_id=${aa}`],
    ['pipeline_stages',`account_id=${aa}`],['notifications',`account_id=${aa} AND user_id='${a}'`]
  ])sql+=`SELECT jsonb_build_object('case','A_reads_own_${table}','visible',count(*)) FROM ${table} WHERE ${predicate};\n`;
  for(const [table,column,value] of [
    ['messages','status',"'read'"],['pipeline_stages','name',"'Synthetic intrusion'"],
    ['notifications','read_at','now()'],['profiles','full_name',"'Synthetic intrusion'"]
  ]) {
    test('A_cannot_update_B_'+table+'_extra',`UPDATE ${table} SET ${column}=${value} WHERE account_id=${ab}`);
    test('A_cannot_delete_B_'+table+'_extra',`DELETE FROM ${table} WHERE account_id=${ab}`);
  }
  test('A_deal_with_B_pipeline',`INSERT INTO deals(user_id,account_id,pipeline_id) VALUES('${a}',${aa},'${pb}')`);
  test('A_stage_with_B_account',`INSERT INTO pipeline_stages(pipeline_id,account_id,name,position) VALUES('${pa}',${ab},'Synthetic intrusion',99)`);
  test('A_message_with_B_account',`INSERT INTO messages(conversation_id,account_id,sender_type) VALUES('${va}',${ab},'agent')`);
  test('A_notification_with_B_user',`INSERT INTO notifications(account_id,user_id,title) VALUES(${aa},'${b}','Synthetic intrusion')`);
  test('A_cannot_insert_B_storage',`INSERT INTO storage.objects(bucket_id,name) VALUES('chat-media','account-'||${ab}::text||'/intrusion.txt')`);
  test('A_cannot_update_B_storage',`UPDATE storage.objects SET name='account-'||${aa}::text||'/stolen.txt' WHERE name='account-'||${ab}::text||'/synthetic-private-b.txt'`);
  test('A_can_insert_own_contact',`INSERT INTO contacts(user_id,account_id,phone) VALUES('${a}',${aa},'15550000099')`);
  test('A_can_insert_own_storage',`INSERT INTO storage.objects(bucket_id,name) VALUES('chat-media','account-'||${aa}::text||'/allowed.txt')`);
}

for(const table of ['accounts','profiles','deal_loss_events','automations','flows','broadcasts','meta_ad_attributions','meta_conversion_events']){
const predicate=table==='accounts'?`id=${ab}`:`account_id=${ab}`;
sql+=`SELECT jsonb_build_object('case','A_cannot_read_B_${table}','visible',count(*)) FROM ${table} WHERE ${predicate};\n`;
}
sql+=`SELECT jsonb_build_object('case','A_reads_B_storage_metadata','visible',count(*)) FROM storage.objects WHERE bucket_id='chat-media' AND name='account-'||${ab}::text||'/synthetic-private-b.txt';\n`;
test('A_cannot_delete_B_storage',`DELETE FROM storage.objects WHERE bucket_id='chat-media' AND name='account-'||${ab}::text||'/synthetic-private-b.txt'`);
test('A_cannot_create_attribution_with_B_contact',`INSERT INTO meta_ad_attributions(account_id,contact_id,ctwa_clid) VALUES(${aa},'${cb}','synthetic-forged')`);
test('A_cannot_reassign_meta_config_account',`UPDATE meta_conversion_config SET account_id=${ab} WHERE account_id=${aa}`);
test('A_cannot_mutate_B_conversion_event',`UPDATE meta_conversion_events SET status='pending' WHERE account_id=${ab}`);
test('A_broadcast_recipient_with_B_contact',`INSERT INTO broadcast_recipients(broadcast_id,contact_id) VALUES('${id('c',1)}','${cb}')`);
test('A_cannot_update_B_contact',`UPDATE contacts SET name='Synthetic Intrusion' WHERE id='${cb}'`);
test('A_cannot_reassign_contact_account',`UPDATE contacts SET account_id=${ab} WHERE id='${ca}'`);
test('A_cannot_change_own_membership',`UPDATE profiles SET account_id=${ab},account_role='owner' WHERE user_id='${a}'`);
test('A_conversation_with_B_contact',`INSERT INTO conversations(user_id,account_id,contact_id) VALUES('${a}',${aa},'${cb}')`);
test('A_note_with_B_contact',`INSERT INTO contact_notes(user_id,account_id,contact_id,note_text) VALUES('${a}',${aa},'${cb}','Synthetic note')`);
test('A_contact_with_B_tag',`INSERT INTO contact_tags(contact_id,tag_id) VALUES('${ca}','${tb}')`);
test('A_contact_with_B_custom_field',`INSERT INTO contact_custom_values(contact_id,custom_field_id,value) VALUES('${ca}','${fb}','Synthetic value')`);
test('A_reply_to_B_message',`INSERT INTO messages(conversation_id,sender_type,content_text,reply_to_message_id) VALUES('${va}','agent','Synthetic reply','${mb}')`);
test('A_deal_with_B_contact',`INSERT INTO deals(user_id,account_id,pipeline_id,contact_id) VALUES('${a}',${aa},'${pa}','${cb}')`);
test('A_deal_assigned_to_B_profile',`UPDATE deals SET assigned_to=(SELECT id FROM profiles WHERE user_id='${b}') WHERE id='${da}'`);
// A guessed foreign UUID, not an RLS-scoped lookup: resolve before resetting role.
sql+=`RESET ROLE; SELECT set_config('audit.profile_b',id::text,true) FROM profiles WHERE user_id='${b}'; SET LOCAL ROLE authenticated;\n`;
test('A_deal_assigned_to_guessed_B_profile',`UPDATE deals SET assigned_to=current_setting('audit.profile_b')::uuid WHERE id='${da}'`);
test('A_membership_rpc_targets_B',`PERFORM set_member_role('${b}','agent')`);
test('A_remove_owner_self',`PERFORM remove_account_member('${a}')`);
test('A_owner_pointer_direct_change',`UPDATE accounts SET owner_user_id='${b}' WHERE id=${aa}`);
sql+=`SAVEPOINT leak; DO $leak$ BEGIN UPDATE conversations SET assigned_agent_id='${b}' WHERE id='${va}'; EXCEPTION WHEN OTHERS THEN NULL; END $leak$; RESET ROLE;
SELECT set_config('request.jwt.claim.sub','${b}',true),set_config('request.jwt.claims','{"sub":"${b}","role":"authenticated"}',true); SET LOCAL ROLE authenticated;
SELECT jsonb_build_object('case','B_reads_notification_from_A_assignment','visible',count(*)) FROM notifications WHERE account_id=${aa} AND user_id='${b}';
ROLLBACK TO SAVEPOINT leak; RELEASE SAVEPOINT leak;
RESET ROLE; SELECT set_config('request.jwt.claim.sub','${b}',true),set_config('request.jwt.claims','{"sub":"${b}","role":"authenticated"}',true); SET LOCAL ROLE authenticated;
`;
for(const [table,key,value] of [['contacts','id',ca],['conversations','id',va],['messages','id',ma],['pipelines','id',pa],['deals','id',da]])sql+=`SELECT jsonb_build_object('case','B_cannot_read_A_${table}','visible',count(*)) FROM ${table} WHERE ${key}='${value}';\n`;
for(const table of ['whatsapp_config','meta_conversion_config','meta_ad_attributions','meta_conversion_events','automations','flows','broadcasts','deal_loss_events'])sql+=`SELECT jsonb_build_object('case','B_cannot_read_A_${table}','visible',count(*)) FROM ${table} WHERE account_id=${aa};\n`;
sql+=`RESET ROLE;
SAVEPOINT status; UPDATE messages SET status='read' WHERE message_id='synthetic-reused-wamid' ${process.env.WACRM_AUDIT_MIGRATION ? `AND account_id=${aa}` : ''};
SELECT jsonb_build_object('case','status_update_with_tenant_filter','affected_accounts',count(DISTINCT c.account_id)) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.message_id='synthetic-reused-wamid' AND m.status='read';
ROLLBACK TO SAVEPOINT status; RELEASE SAVEPOINT status;
`;
if(process.env.WACRM_AUDIT_MIGRATION){
sql+=`SET LOCAL ROLE service_role;\n`;
test('service_role_cross_conversation_denied',`INSERT INTO conversations(user_id,account_id,contact_id) VALUES('${a}',${aa},'${cb}')`);
test('service_role_cross_tag_denied',`INSERT INTO contact_tags(contact_id,tag_id) VALUES('${ca}','${tb}')`);
test('service_role_cross_field_denied',`INSERT INTO contact_custom_values(contact_id,custom_field_id,value) VALUES('${ca}','${fb}','Synthetic')`);
test('service_role_cross_reply_denied',`INSERT INTO messages(conversation_id,sender_type,reply_to_message_id) VALUES('${va}','agent','${mb}')`);
test('service_role_cross_recipient_denied',`INSERT INTO broadcast_recipients(broadcast_id,contact_id) VALUES('${id('c',1)}','${cb}')`);
sql+=`RESET ROLE;\n`;
}
for(const role of ['admin','agent','viewer']){
sql+=`SAVEPOINT role_case; UPDATE profiles SET account_role='${role}' WHERE user_id='${a}'; SELECT set_config('request.jwt.claim.sub','${a}',true),set_config('request.jwt.claims','{"sub":"${a}","role":"authenticated"}',true); SET LOCAL ROLE authenticated;\n`;
test(role+'_update_own_contact',`UPDATE contacts SET name='Synthetic Changed' WHERE id='${ca}'`);
test(role+'_update_own_whatsapp',`UPDATE whatsapp_config SET status='connected' WHERE account_id=${aa}`);
test(role+'_upload_own_chat_media',`INSERT INTO storage.objects(bucket_id,name) VALUES('chat-media','account-'||${aa}::text||'/synthetic-audit.txt')`);
sql+=`RESET ROLE; ROLLBACK TO SAVEPOINT role_case; RELEASE SAVEPOINT role_case;\n`;
}
sql+=`RESET ROLE; SAVEPOINT orphan_profile;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('f1000000-0000-4000-8000-000000000003','audit-orphan@example.invalid','{}');
DELETE FROM profiles WHERE user_id='f1000000-0000-4000-8000-000000000003';
SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true),set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
`;
test('orphan_auth_user_inserts_foreign_owner_profile',`INSERT INTO profiles(user_id,account_id,account_role,full_name,email) VALUES('f1000000-0000-4000-8000-000000000003',${ab},'owner','Synthetic Orphan','audit-orphan@example.invalid')`);
if(process.env.WACRM_AUDIT_MIGRATION){
sql+=`SELECT set_config('audit.account_c',public.create_my_account()::text,true);
SELECT jsonb_build_object('case','official_orphan_account_creation','different_from_A_B',current_setting('audit.account_c')::uuid NOT IN (${aa},${ab}),'owner',account_role='owner') FROM profiles WHERE user_id='f1000000-0000-4000-8000-000000000003';
SELECT jsonb_build_object('case','official_onboarding_idempotent','same',public.create_my_account()::text=current_setting('audit.account_c'),'pipelines',(SELECT count(*) FROM pipelines WHERE account_id=current_setting('audit.account_c')::uuid));
RESET ROLE; INSERT INTO account_invitations(account_id,role,token_hash,expires_at) VALUES(${ab},'agent','synthetic-official-invite',now()+interval '1 hour'); SET LOCAL ROLE authenticated;
`;
  sql+=`RESET ROLE; SAVEPOINT customized_defaults; UPDATE pipeline_stages SET name='Customized' WHERE account_id=current_setting('audit.account_c')::uuid AND NOT is_lost_stage; SET LOCAL ROLE authenticated;`;
  test('customized_onboarding_account_not_discarded',`PERFORM public.redeem_invitation('synthetic-official-invite')`);
  sql+=`RESET ROLE; ROLLBACK TO SAVEPOINT customized_defaults; RELEASE SAVEPOINT customized_defaults; SET LOCAL ROLE authenticated;
SELECT jsonb_build_object('case','official_invite_redeem','correct_account',public.redeem_invitation('synthetic-official-invite')=${ab});
`;
test('official_invite_single_use_denied',`PERFORM public.redeem_invitation('synthetic-official-invite')`);
}
sql+=`RESET ROLE; ROLLBACK TO SAVEPOINT orphan_profile; RELEASE SAVEPOINT orphan_profile; SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;`;
// Validate every fixture INSERT column against the captured live schema before
// opening the local cluster; do not iterate guessed fixture schema.
for(const match of sql.matchAll(/INSERT INTO ([a-z_]+)\(([^)]+)\)/g)){
 const columns=new Set(source.columns.filter(c=>c.table===match[1]).map(c=>c.column));
 if(['contact_tags','contact_custom_values','messages','pipeline_stages','broadcast_recipients','automation_steps','message_reactions','flow_nodes','flow_run_events'].includes(match[1]))columns.add('account_id');
 for(const column of match[2].split(','))if(!columns.has(column.trim()))throw new Error('Unknown fixture column '+match[1]+'.'+column);
}
let started=false;
try{
run('/usr/bin/sandbox-exec',['-p',state.policy,lab+'/runtime/bin/pg_ctl','start','-D',state.data,'-l',lab+'/server.log','-o',state.options,'-w','-t','30']);started=true;
const localFns=JSON.parse(psql(`SELECT jsonb_agg(jsonb_build_object('name',proname,'definition',pg_get_functiondef(oid))) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f' AND proname IN (${source.functions.map(f=>"'"+f.name+"'").join(',')});`).stdout.trim());
const drift=source.functions.filter(f=>!localFns.some(l=>l.name===f.name&&l.definition===f.definition)).map(f=>f.name);if(drift.length)throw new Error('Historical laboratory function drift: '+drift.join(','));
const localPolicies=JSON.parse(psql("SELECT jsonb_agg(to_jsonb(p)) FROM pg_policies p WHERE schemaname IN ('public','storage');").stdout.trim());
const canonical=o=>JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a],[b])=>a.localeCompare(b))));
const policyDrift=source.policies.filter(p=>!localPolicies.some(l=>canonical(l)===canonical(p))).map(p=>p.policyname);if(policyDrift.length)throw new Error('Historical laboratory policy drift: '+policyDrift.join(','));
const localConstraints=JSON.parse(psql("SELECT jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid))) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public';").stdout.trim());
const constraintDrift=source.constraints.filter(p=>!localConstraints.some(l=>canonical(l)===canonical(p))).map(p=>p.name);if(constraintDrift.length)throw new Error('Historical laboratory constraint drift: '+constraintDrift.join(','));
const before=psql(`BEGIN READ ONLY; SET LOCAL TIME ZONE 'UTC'; ${fs.readFileSync(root+'/data-check-query.sql','utf8')} COMMIT;`).stdout;
const result=psql(sql);const cases=[...result.stdout.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x)),...result.stderr.split('\n').filter(x=>x.startsWith('NOTICE:  AUDIT ')).map(x=>JSON.parse(x.slice('NOTICE:  AUDIT '.length)))];
const after=psql(`BEGIN READ ONLY; SET LOCAL TIME ZONE 'UTC'; ${fs.readFileSync(root+'/data-check-query.sql','utf8')} COMMIT;`).stdout;
if(before!==after)throw new Error('Historical laboratory changed after rollback');
const find=name=>{const row=cases.find(c=>c.case===name);if(!row)throw new Error('Missing native regression '+name);return row;};
for(const row of cases){
 if(/^(A_cannot_read_B_|B_cannot_read_A_)/.test(row.case) && row.visible!==0)throw new Error('Cross-account read '+row.case);
 if(/A_cannot_(delete|update)_B_/.test(row.case)&&row.accepted&&row.rows!==0)throw new Error('Cross-account mutation '+row.case);
 if(row.case.startsWith('A_reads_own_')&&row.visible<1)throw new Error('Own read blocked '+row.case);
}
for(const name of ['A_conversation_with_B_contact','A_note_with_B_contact','A_contact_with_B_tag','A_contact_with_B_custom_field','A_reply_to_B_message','A_broadcast_recipient_with_B_contact','A_deal_assigned_to_guessed_B_profile','A_owner_pointer_direct_change','orphan_auth_user_inserts_foreign_owner_profile','viewer_upload_own_chat_media','official_invite_single_use_denied','service_role_cross_conversation_denied','service_role_cross_tag_denied','service_role_cross_field_denied','service_role_cross_reply_denied','service_role_cross_recipient_denied','A_deal_with_B_pipeline','A_stage_with_B_account','A_message_with_B_account','A_notification_with_B_user','A_cannot_insert_B_storage','customized_onboarding_account_not_discarded'])if(find(name).accepted!==false)throw new Error('Attack accepted '+name);
for(const name of ['A_can_insert_own_contact','A_can_insert_own_storage'])if(!find(name).accepted)throw new Error('Own insert blocked '+name);
if(find('A_reads_B_storage_metadata').visible!==0||find('B_reads_notification_from_A_assignment').visible!==0)throw new Error('Notification/Storage leak');
if(find('status_update_with_tenant_filter').affected_accounts!==1)throw new Error('Status affected foreign tenant');
if(find('signup_bootstrap').initial_pipelines!==2||!find('official_orphan_account_creation').different_from_A_B||!find('official_onboarding_idempotent').same||!find('official_invite_redeem').correct_account)throw new Error('Onboarding/invitation regression');
fs.writeFileSync(root+'/saas-regression-21g.json',JSON.stringify({function_drift:drift,policy_drift:policyDrift,constraint_drift:constraintDrift,cases,rollback_unchanged:true,external_integrations:false},null,2),{mode:0o600});console.log(JSON.stringify({observations:cases.length,pass:true,rollback_unchanged:true,external_integrations:false}));
}finally{if(started){run('/usr/bin/sandbox-exec',['-p',state.policy,lab+'/runtime/bin/pg_ctl','stop','-D',state.data,'-m','fast','-w','-t','30']);console.log('Private historical lab stopped.');}}
