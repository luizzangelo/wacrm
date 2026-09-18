import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import { compareMigration, sqlChecksum, splitSqlStatements } from './migration-equivalence.mjs';

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
for(const file of ['001_initial_schema.sql','017_account_sharing.sql','040_meta_conversions_foundation.sql','041_meta_conversion_stage_outbox.sql','042_meta_conversion_delivery_certainty.sql']) {
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
