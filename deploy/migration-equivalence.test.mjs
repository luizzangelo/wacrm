import assert from 'node:assert/strict';
import test from 'node:test';
import { compareMigration, sqlChecksum } from './migration-equivalence.mjs';

test('different timestamps with exactly equivalent SQL must not be reapplied', () => {
  const ledger=[{version:'20260917043852',statements:['CREATE TABLE fixture(id UUID);\n']}];
  assert.equal(compareMigration('20260917035905_fixture.sql','CREATE TABLE fixture(id UUID);',ledger).result,'ALREADY_EQUIVALENT');
});
test('same version with different or unavailable SQL blocks; no name-only equivalence', () => {
  for(const statements of [[],['SELECT 2;']]) {
    assert.equal(compareMigration('001_fixture.sql','SELECT 1;',[{version:'001',statements}]).result,'BLOCKED_VERSION_SQL_MISMATCH');
  }
  assert.equal(compareMigration('002_fixture.sql','SELECT 1;',[{version:'001',statements:['SELECT 2;']}]).result,'REVIEW_NOT_PROVEN');
});
test('only CRLF/outer whitespace normalization; internal text is not rewritten', () => {
  assert.equal(sqlChecksum(' SELECT 1;\r\n'),sqlChecksum('SELECT 1;'));
  assert.notEqual(sqlChecksum("SELECT 'A B';"),sqlChecksum("SELECT 'AB';"));
});
