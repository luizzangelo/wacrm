import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import { compareMigration, sqlChecksum, splitSqlStatements, inspectSql } from './migration-equivalence.mjs';

test('different timestamps with exactly equivalent SQL must not be reapplied', () => {
  const ledger=[{version:'20260917043852',statements:['CREATE TABLE fixture(id UUID);\n']}];
  assert.equal(compareMigration('20260917035905_fixture.sql','CREATE TABLE fixture(id UUID);',ledger).result,'ALREADY_EQUIVALENT');
});
test('same version with different or unavailable SQL blocks; no name-only equivalence', () => {
  for(const statements of [[],['SELECT 2;']]) {
    assert.equal(compareMigration('001_fixture.sql','SELECT 1;',[{version:'001',statements}]).result,statements.length ? 'MATERIAL_MISMATCH' : 'UNKNOWN');
  }
  assert.equal(compareMigration('002_fixture.sql','SELECT 1;',[{version:'001',statements:['SELECT 2;']}]).result,'PENDING');
});
const compare=(sql,statements)=>compareMigration('001_fixture.sql',sql,[{version:'001',name:'fixture',statements}]).result;
for(const [name,sql,remote] of [
  ['simple','SELECT 1',['SELECT 1']],
  ['multiple','SELECT 1; SELECT 2;',['SELECT 1','SELECT 2']],
  ['external delimiter','SELECT 1;',['SELECT 1']],
  ['string semicolon',"SELECT 'a;b';",["SELECT 'a;b'"]],
  ['doubled quotes',"SELECT 'a'';b';",["SELECT 'a'';b'"]],
  ['E string',"SELECT E'a\\\';b';",["SELECT E'a\\\';b'"]],
  ['ordinary backslash',"SELECT 'a\\'; SELECT 2;",["SELECT 'a\\'",'SELECT 2']],
  ['identifier','SELECT "a;""b";',['SELECT "a;""b"']],
  ['plpgsql','CREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; END; $$ LANGUAGE plpgsql;',['CREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; END; $$ LANGUAGE plpgsql']],
  ['dollar tag','SELECT $tag$a;b$tag$;',['SELECT $tag$a;b$tag$']],
  ['comment','-- keep ;\nSELECT 1;',['-- keep ;\nSELECT 1']],
  ['nested comments','/* a; /* b; */ c */ SELECT 1;',['/* a; /* b; */ c */ SELECT 1']],
  ['CRLF edges','\r\nSELECT 1;\r\nSELECT 2;\r\n',['SELECT 1','SELECT 2']],
  ['between statements','  SELECT 1; \n\t SELECT 2; ',['SELECT 1','SELECT 2']],
  ['whole remote entry','SELECT 1;SELECT 2;',['SELECT 1;SELECT 2;']],
]) test(name,()=>assert.equal(compare(sql,remote),'ALREADY_EQUIVALENT'));
for(const [name,sql,remote] of [
  ['real SQL difference','SELECT 1;',['SELECT 2']],
  ['order','SELECT 1; SELECT 2;',['SELECT 2','SELECT 1']],
  ['removed','SELECT 1; SELECT 2;',['SELECT 1']],
  ['extra','SELECT 1;',['SELECT 1','SELECT 2']],
  ['changed comment','-- A\nSELECT 1;',['-- B\nSELECT 1']],
  ['internal whitespace','SELECT  1;',['SELECT 1']],
  ['internal CRLF','-- keep\r\nSELECT 1;',['-- keep\nSELECT 1']],
]) test(name,()=>assert.equal(compare(sql,remote),'MATERIAL_MISMATCH'));
for(const sql of ['', ' ; ', '-- comment', '/* comment */', "SELECT 'open", 'SELECT $$open', '/* open'])
  test('empty/incomplete '+JSON.stringify(sql),()=>assert.equal(compare(sql,['SELECT 1']),'UNKNOWN'));
for(const statements of [[],null,[''],['/* open'],[42]])
  test('unavailable remote '+JSON.stringify(statements),()=>assert.equal(compare('SELECT 1;',statements),'UNKNOWN'));
test('same name different version with changed SQL',()=>assert.equal(compareMigration('002_fixture.sql','SELECT 3;',[{version:'001',name:'fixture',statements:['SELECT 1']}]).result,'MATERIAL_MISMATCH'));
test('collision cannot hide behind equivalent row',()=>assert.equal(compareMigration('001_fixture.sql','SELECT 1;',[{version:'001',statements:['SELECT 2']},{version:'002',statements:['SELECT 1']}]).result,'MATERIAL_MISMATCH'));
test('duplicate ledger unknown',()=>assert.equal(compareMigration('001_fixture.sql','SELECT 1;',[{version:'001'},{version:'001'}]).result,'UNKNOWN'));
test('dollar within identifier',()=>assert.deepEqual(splitSqlStatements('SELECT foo$tag$; SELECT 2;'),['SELECT foo$tag$','SELECT 2']));
for(const file of ['001_initial_schema.sql','006_automations.sql','011_profile_beta_features.sql','017_account_sharing.sql','020_account_sharing_followups.sql','032_fix_ai_knowledge_membership.sql','033_ai_reply_polish.sql','034_fix_profiles_update_rls.sql','040_meta_conversions_foundation.sql','041_meta_conversion_stage_outbox.sql','042_meta_conversion_delivery_certainty.sql']) {
  test('real fixture '+file,()=>{
    const sql=readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
    const statements=splitSqlStatements(sql);
    assert.equal(compareMigration(file,sql,[{version:file.split('_')[0],statements}]).result,'ALREADY_EQUIVALENT');
    const changed=[...statements];changed[0]+=' /* changed */';
    assert.equal(compareMigration(file,sql,[{version:file.split('_')[0],statements:changed}]).result,'MATERIAL_MISMATCH');
  });
}
test('only CRLF/outer whitespace normalization; internal text is not rewritten', () => {
  assert.equal(sqlChecksum(' SELECT 1;\r\n'),sqlChecksum('SELECT 1;'));
  assert.notEqual(sqlChecksum("SELECT 'A B';"),sqlChecksum("SELECT 'AB';"));
});
for(const [name,comment] of [
  ['line comment','-- comment'],
  ['block comment','/* comment */'],
  ['multiline comment','/* first\nsecond */'],
  ['consecutive comments','-- first\n/* second */\n-- third'],
  ['outer whitespace',' \n\t-- comment\n '],
  ['delimiter then comment','; -- comment'],
  ['semicolon within comment','-- comment ; SELECT 2;'],
  ['single quote within comment',"/* comment ' */"],
  ['dollar text within comment','-- $$ $tag$ comment'],
]) {
  test('valid isolated representation: '+name,()=>{
    const parsed=inspectSql(comment);
    assert.equal(parsed.kind,'COMMENTS_ONLY');
    assert.equal(parsed.statements.length,1);
    assert.equal(compare('SELECT 1; '+comment,['SELECT 1',comment]),'ALREADY_EQUIVALENT');
    assert.equal(compareMigration('001_fixture.sql',comment,[{version:'001',statements:[comment]}]).reason,'COMMENTS_ONLY_MIGRATION');
  });
}
for(const [name,sql,remote] of [
  ['SQL then line comment','SELECT 1;\n-- final',['SELECT 1','-- final']],
  ['SQL then block comment','SELECT 1;\n/* final */',['SELECT 1','/* final */']],
  ['comment then SQL','-- first\nSELECT 1;',['-- first\nSELECT 1']],
  ['multiple separate comments','/* first */;SELECT 1;-- last',['/* first */','SELECT 1','-- last']],
  ['empty entries ignored','; SELECT 1; ; -- final',['',';','SELECT 1',' ; ','-- final']],
  ['whole remote migration with final comment','SELECT 1;-- final',['SELECT 1;-- final']],
]) test('mixed comments: '+name,()=>assert.equal(compare(sql,remote),'ALREADY_EQUIVALENT'));
for(const [name,sql,remote] of [
  ['different SQL same final comment','SELECT 1;-- final',['SELECT 2','-- final']],
  ['different final comment same SQL','SELECT 1;-- final',['SELECT 1','-- changed']],
  ['reordered SQL with final comment','SELECT 1;SELECT 2;-- final',['SELECT 2','SELECT 1','-- final']],
  ['extra SQL with final comment','SELECT 1;-- final',['SELECT 1','SELECT 2','-- final']],
  ['removed SQL with final comment','SELECT 1;SELECT 2;-- final',['SELECT 1','-- final']],
  ['removed final comment','SELECT 1;-- final',['SELECT 1']],
  ['extra final comment','SELECT 1;',['SELECT 1','-- final']],
]) test('material mixed difference: '+name,()=>assert.equal(compare(sql,remote),'MATERIAL_MISMATCH'));
for(const sql of ['', ' \n\t ', ' ; ; ']) test('whole empty migration classified '+JSON.stringify(sql),()=>{
  assert.deepEqual(inspectSql(sql),{statements:[],kind:'EMPTY'});
  const result=compareMigration('001_empty.sql',sql,[]);
  assert.equal(result.result,'UNKNOWN');assert.equal(result.reason,'EMPTY_MIGRATION');
});
test('whole comments-only migration is distinct from empty and never auto-applied',()=>{
  const sql='-- first\n/* second */';
  for(const ledger of [[],[{version:'001',statements:['-- first\n/* second */']}]]){
    const result=compareMigration('001_comments.sql',sql,ledger);
    assert.equal(result.result,'UNKNOWN');assert.equal(result.input_kind,'COMMENTS_ONLY');
    assert.equal(result.reason,'COMMENTS_ONLY_MIGRATION');
  }
});
test('unavailable ledger row cannot be made executable by comments',()=>{
  for(const statements of [[],[''],['-- only'],['/* only */'],[';','-- only']])
    assert.equal(compare('SELECT 1;',statements),'UNKNOWN');
});
for(const file of ['006_automations.sql','011_profile_beta_features.sql','020_account_sharing_followups.sql','032_fix_ai_knowledge_membership.sql','033_ai_reply_polish.sql','034_fix_profiles_update_rls.sql']) {
  test('real isolated final comment fixture '+file,()=>{
    const sql=readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
    const statements=splitSqlStatements(sql);
    assert.equal(inspectSql(statements.at(-1)).kind,'COMMENTS_ONLY');
    assert.equal(compareMigration(file,sql,[{version:file.split('_')[0],statements}]).result,'ALREADY_EQUIVALENT');
    const changed=[...statements];changed[changed.length-1]+='\n-- different';
    assert.equal(compareMigration(file,sql,[{version:file.split('_')[0],statements:changed}]).result,'MATERIAL_MISMATCH');
  });
}
