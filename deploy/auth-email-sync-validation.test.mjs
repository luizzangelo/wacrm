import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AUTH_EMAIL_TRIGGER_SQL,validateAuthEmailTrigger,validateEmailWhen} from './auth-email-sync-validation.mjs';
const prefix='CREATE TRIGGER sync_auth_email_to_profile AFTER UPDATE OF email ON auth.users FOR EACH ROW WHEN ';
const suffix=' EXECUTE FUNCTION wacrm_private.sync_auth_email_to_profile()';
const plain='((old.email IS DISTINCT FROM new.email))';
const postgres='(((old.email)::text IS DISTINCT FROM (new.email)::text))';
const fixture=(condition=plain)=>({name:'sync_auth_email_to_profile',table_schema:'auth',table_name:'users',
 type:17,enabled:'O',internal:false,function_schema:'wacrm_private',function_name:'sync_auth_email_to_profile',
 function_arg_count:0,trigger_arg_count:0,columns:['email'],email_type:'character varying(255)',
 old_transition_table:null,new_transition_table:null,constraint_oid:0,definition:prefix+condition+suffix});
test('expected definition without casts passes',()=>assert.equal(validateAuthEmailTrigger([fixture()]).valid,true));
test('actual PostgreSQL definition with text casts passes',()=>assert.equal(validateAuthEmailTrigger([fixture(postgres)]).valid,true));
test('both definitions have exactly the same validation result',()=>assert.deepEqual(validateAuthEmailTrigger([fixture()]),validateAuthEmailTrigger([fixture(postgres)])));
for(const [label,key,value] of [
 ['different function','function_name','other'],['different function schema','function_schema','public'],
 ['different table','table_name','identities'],['different schema','table_schema','public'],
 ['different event','type',5],['multiple events','type',21],['before update','type',19],
 ['statement trigger','type',16],['different trigger','name','other'],['disabled','enabled','D'],
 ['replica only','enabled','R'],['wrong column','columns',['email_change']],['extra column','columns',['email','id']],
 ['arguments','trigger_arg_count',1],['transition table','old_transition_table','oldrows'],
 ['internal trigger','internal',true],['unproven citext cast','email_type','citext'],
]) test(label+' fails',()=>assert.throws(()=>validateAuthEmailTrigger([{...fixture(postgres),[key]:value}])));
for(const condition of [
 '(old.email IS NOT DISTINCT FROM new.email)','(old.email = new.email)',
 '(old.id IS DISTINCT FROM new.id)','(old.email IS DISTINCT FROM new.email_change)',
 '(new.email IS DISTINCT FROM old.email)','(old.email IS DISTINCT FROM new.email OR true)',
 '((old.email)::integer IS DISTINCT FROM (new.email)::integer)',
 '((old.email)::citext IS DISTINCT FROM (new.email)::citext)',
 '(lower(old.email) IS DISTINCT FROM lower(new.email))',
 '(old.email IS DISTINCT FROM new.email); SELECT true',
 '((old.email IS DISTINCT FROM new.email)',
]) test('material WHEN difference fails: '+condition,()=>assert.throws(()=>validateAuthEmailTrigger([fixture(condition)])));
test('qualified text cast and harmless parentheses pass',()=>assert.equal(validateEmailWhen('((((old.email))::pg_catalog.text) IS DISTINCT FROM ((new.email)::text))','text'),true));
test('missing and duplicate triggers fail',()=>{assert.throws(()=>validateAuthEmailTrigger([]));assert.throws(()=>validateAuthEmailTrigger([fixture(),fixture()]));});
for(const [label,from,to] of [['function','wacrm_private.sync_auth_email_to_profile()','wacrm_private.other()'],['table','ON auth.users','ON auth.identities'],['event','AFTER UPDATE','AFTER INSERT'],['trigger','CREATE TRIGGER sync_auth_email_to_profile','CREATE TRIGGER other']])
 test('decompiled '+label+' disagreement fails',()=>assert.throws(()=>validateAuthEmailTrigger([{...fixture(),definition:fixture().definition.replace(from,to)}])));
test('inspection SQL is SELECT only and checks named triggers across relations',()=>{
 assert.ok(AUTH_EMAIL_TRIGGER_SQL.startsWith('SELECT '));
 assert.ok(!/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/i.test(AUTH_EMAIL_TRIGGER_SQL));
 assert.ok(AUTH_EMAIL_TRIGGER_SQL.includes("WHERE t.tgname='sync_auth_email_to_profile'"));
});
