// Read-only inspection tooling. No connection, write, migration or ledger repair.
import assert from 'node:assert/strict';

// PostgreSQL OIDs are unsigned 32-bit integers; JSON may encode them as strings.
// Missing values remain missing. No loose equality or generic payload coercion.
export function normalizeOid(value) {
 if(value===null||value===undefined) return value;
 if(typeof value==='number') {
  assert.ok(Number.isInteger(value)&&value>=0&&value<=4_294_967_295,'Invalid numeric OID');
  return String(value);
 }
 assert.ok(typeof value==='string'&&/^\d{1,10}$/.test(value),'Invalid serialized OID');
 const oid=BigInt(value);
 assert.ok(oid<=4_294_967_295n,'OID exceeds PostgreSQL range');
 return oid.toString();
}

export const AUTH_EMAIL_TRIGGER_SQL = `SELECT coalesce(jsonb_agg(jsonb_build_object(
 'name',t.tgname,'table_schema',n.nspname,'table_name',c.relname,
 'type',t.tgtype,'enabled',t.tgenabled,'internal',t.tgisinternal,
 'function_schema',pn.nspname,'function_name',p.proname,
 'function_arg_count',p.pronargs,'trigger_arg_count',t.tgnargs,
 'columns',ARRAY(SELECT a.attname FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY x(num,pos)
   JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=x.num ORDER BY x.pos),
 'email_type',(SELECT format_type(a.atttypid,a.atttypmod) FROM pg_attribute a
   WHERE a.attrelid=t.tgrelid AND a.attname='email'),
 'old_transition_table',t.tgoldtable,'new_transition_table',t.tgnewtable,
 'constraint_oid',t.tgconstraint,'definition',pg_get_triggerdef(t.oid)) ORDER BY t.oid),'[]')
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
 JOIN pg_namespace pn ON pn.oid=p.pronamespace
 WHERE t.tgname='sync_auth_email_to_profile'`;

function tokens(expression) {
 const result=[]; const lexer=/\s+|::|[().]|[a-z_][a-z0-9_]*/iy;
 let offset=0;
 while(offset<expression.length) {
  lexer.lastIndex=offset; const match=lexer.exec(expression);
  if(!match) throw new Error('Unsupported WHEN expression');
  if(!/^\s+$/.test(match[0])) result.push(match[0].toLowerCase());
  offset=lexer.lastIndex;
 }
 return result;
}
function unwrap(input) {
 let result=input;
 while(result[0]==='(') {
  let depth=0,closing=-1;
  for(let i=0;i<result.length;i++) {
   if(result[i]==='(') depth++;
   if(result[i]===')'&&--depth===0) {closing=i;break;}
  }
  if(closing!==result.length-1) break;
  result=result.slice(1,-1);
 }
 return result;
}
function reference(input,expected) {
 let result=unwrap(input); let cast=false;
 // Only text casts on these two exact references, never a blanket cast removal.
 if(result.slice(-2).join(' ')===':: text') {result=result.slice(0,-2);cast=true;}
 else if(result.slice(-4).join(' ')===':: pg_catalog . text') {result=result.slice(0,-4);cast=true;}
 result=unwrap(result);
 assert.deepEqual(result,[expected,'.','email'],'Unexpected WHEN operand');
 return cast;
}
export function validateEmailWhen(expression,emailType) {
 assert.ok(emailType==='text'||/^character varying(?:\(\d+\))?$/.test(emailType),
  'Cannot prove text cast equivalence for this column type');
 const input=unwrap(tokens(expression));
 let depth=0,operator=-1;
 for(let i=0;i<input.length;i++) {
  if(input[i]==='(') depth++;
  else if(input[i]===')') depth--;
  assert.ok(depth>=0,'Unbalanced WHEN expression');
  if(depth===0&&input.slice(i,i+3).join(' ')==='is distinct from') {
   assert.equal(operator,-1,'Multiple WHEN operators');operator=i;
  }
 }
 assert.equal(depth,0,'Unbalanced WHEN expression'); assert.ok(operator>0,'Wrong WHEN condition');
 reference(input.slice(0,operator),'old');
 reference(input.slice(operator+3),'new');
 return true;
}
export function validateAuthEmailTrigger(rows) {
 assert.ok(Array.isArray(rows)); assert.equal(rows.length,1,'Expected exactly one named trigger');
 const t={...rows[0],constraint_oid:normalizeOid(rows[0].constraint_oid)};
 const expected={name:'sync_auth_email_to_profile',table_schema:'auth',table_name:'users',
  type:17,enabled:'O',internal:false,function_schema:'wacrm_private',
  function_name:'sync_auth_email_to_profile',function_arg_count:0,trigger_arg_count:0,
  columns:['email'],old_transition_table:null,new_transition_table:null,constraint_oid:'0'};
 for(const [key,value] of Object.entries(expected)) assert.deepEqual(t[key],value,'Wrong trigger '+key);
 const match=t.definition?.match(/^CREATE TRIGGER sync_auth_email_to_profile AFTER UPDATE OF email ON auth\.users FOR EACH ROW WHEN (.+) EXECUTE FUNCTION wacrm_private\.sync_auth_email_to_profile\(\)$/);
 assert.ok(match,'Unexpected decompiled trigger structure');
 validateEmailWhen(match[1],t.email_type);
 return {valid:true,trigger:'sync_auth_email_to_profile',when:'old.email IS DISTINCT FROM new.email'};
}
