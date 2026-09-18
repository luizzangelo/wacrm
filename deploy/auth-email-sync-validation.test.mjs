import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AUTH_EMAIL_TRIGGER_SQL,normalizeOid,validateAuthEmailTrigger,validateEmailWhen} from './auth-email-sync-validation.mjs';
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
for(const [left,right,canonical] of [[0,'0','0'],[12345,'12345','12345'],['0','0','0'],[0,0,'0'],[4294967295,'4294967295','4294967295']])
 test('OID number/string canonical equivalence '+String(left)+'/'+typeof left+' vs '+typeof right,()=>{
  assert.equal(normalizeOid(left),canonical);assert.equal(normalizeOid(right),canonical);
 });
test('different OID strings remain different',()=>assert.notEqual(normalizeOid('12345'),normalizeOid('54321')));
test('different OID numbers remain different',()=>assert.notEqual(normalizeOid(12345),normalizeOid(54321)));
test('null stays null and differs from zero',()=>{assert.equal(normalizeOid(null),null);assert.notEqual(normalizeOid(null),normalizeOid('0'));});
test('undefined stays undefined, not a string',()=>{assert.equal(normalizeOid(undefined),undefined);assert.notEqual(normalizeOid(undefined),'undefined');});
for(const [label,value] of [['alphabetic','abc'],['empty',''],['NaN',NaN],['negative',-1],['object',{}],['array',[]],['fractional',1.5],['Infinity',Infinity],['negative string','-1'],['overflow',4294967296],['overflow string','4294967296'],['boolean',false],['whitespace',' 0'],['decimal string','0.0'],['exponent','1e3'],['hex','0x0'],['bigint',0n]])
 test('invalid OID rejected: '+label,()=>assert.throws(()=>normalizeOid(value)));
test('decimal leading zeros are canonicalized only for OID',()=>assert.equal(normalizeOid('00012345'),'12345'));
test('real catalog row with string zero and PostgreSQL text casts passes',()=>{
 const row={...fixture(postgres),constraint_oid:'0'};const original=structuredClone(row);
 assert.deepEqual(validateAuthEmailTrigger([row]),validateAuthEmailTrigger([fixture(postgres)]));
 assert.deepEqual(row,original,'Validator must not mutate caller data');
});
test('nonzero constraint OIDs fail for both driver representations',()=>{
 for(const constraint_oid of [12345,'12345',54321,'54321'])assert.throws(()=>validateAuthEmailTrigger([{...fixture(postgres),constraint_oid}]));
});
test('missing or null constraint OID cannot pass as zero',()=>{
 for(const constraint_oid of [undefined,null])assert.throws(()=>validateAuthEmailTrigger([{...fixture(postgres),constraint_oid}]));
});
test('non-OID numeric fields are not coerced',()=>{
 for(const key of ['type','trigger_arg_count','function_arg_count'])assert.throws(()=>validateAuthEmailTrigger([{...fixture(postgres),[key]:String(fixture()[key])}]));
});
