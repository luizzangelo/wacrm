// Read-only reconciliation. Never connects to a database or applies/repairs SQL.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Preserve internal bytes. Only delimiters and outer whitespace are removed.
export function inspectSql(sql) {
  if (typeof sql !== 'string') throw new Error('Unavailable SQL');
  const parts = [];
  let start = 0, i = 0, state = '', tag = '', depth = 0, escaped = false;
  let meaningful = false, anyMeaningful = false;
  const finish = (end) => {
    const part = sql.slice(start, end).trim();
    if (part) parts.push(part);
    anyMeaningful ||= meaningful; meaningful = false;
  };
  while (i < sql.length) {
    const pair = sql.slice(i, i + 2);
    if (state === 'line') { if (/\r|\n/.test(sql[i])) state = ''; i++; continue; }
    if (state === 'block') {
      if (pair === '/*') { depth++; i += 2; }
      else if (pair === '*/') { if (--depth === 0) state = ''; i += 2; }
      else i++;
      continue;
    }
    if (state === 'quote' || state === 'identifier') {
      const quote = state === 'quote' ? "'" : '"';
      if (state === 'quote' && escaped && sql[i] === '\\') { i += 2; continue; }
      if (sql[i] === quote) {
        if (sql[i + 1] === quote) { i += 2; continue; }
        state = '';
      }
      i++; continue;
    }
    if (state === 'dollar') {
      if (sql.slice(i, i + tag.length) === tag) { i += tag.length; state = ''; }
      else i++;
      continue;
    }
    if (pair === '--') { state = 'line'; i += 2; continue; }
    if (pair === '/*') { state = 'block'; depth = 1; i += 2; continue; }
    if (sql[i] === "'") {
      state = 'quote'; meaningful = true;
      escaped = /(?:^|[^A-Za-z0-9_$])E$/i.test(sql.slice(0, i));
      i++; continue;
    }
    if (sql[i] === '"') { state = 'identifier'; meaningful = true; i++; continue; }
    const dollar = !/[A-Za-z0-9_$]/.test(sql[i - 1] ?? '') &&
      sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
    if (dollar) { tag = dollar[0]; state = 'dollar'; meaningful = true; i += tag.length; continue; }
    if (sql[i] === ';') { finish(i); start = ++i; continue; }
    if (!/\s/.test(sql[i])) meaningful = true;
    i++;
  }
  if (state && state !== 'line') throw new Error('Unterminated SQL lexical construct');
  finish(sql.length);
  return {
    statements: parts,
    kind: anyMeaningful ? 'SQL' : parts.length ? 'COMMENTS_ONLY' : 'EMPTY',
  };
}
export const splitSqlStatements = (sql) => inspectSql(sql).statements;
export const normalizeSql = (sql) => JSON.stringify(splitSqlStatements(sql));
export const sqlChecksum = (sql) => createHash('sha256').update(normalizeSql(sql)).digest('hex');
export function compareMigration(file, sql, ledger) {
  const version = file.split('_')[0];
  const name = file.slice(version.length + 1).replace(/\.sql$/, '');
  let checksum, local;
  try {
    local = inspectSql(sql);
    checksum = sqlChecksum(sql);
  } catch { return { file, version, result: 'UNKNOWN', reason: 'UNINTERPRETABLE_LOCAL_SQL' }; }
  // Valid lexical comments are not evidence of an executable migration.
  // Keep this classification separate from parsing individual ledger entries.
  if (local.kind !== 'SQL') {
    return { file, version, checksum, result: 'UNKNOWN', input_kind: local.kind,
      reason: local.kind === 'EMPTY' ? 'EMPTY_MIGRATION' : 'COMMENTS_ONLY_MIGRATION' };
  }
  if (!Array.isArray(ledger) || !ledger.every(r => r && typeof r.version === 'string') ||
      new Set(ledger.map(r => r.version)).size !== ledger.length) {
    return { file, version, checksum, result: 'UNKNOWN' };
  }
  const rows = ledger.map(row => {
    try {
      if (!Array.isArray(row.statements) || !row.statements.length) throw new Error();
      const entries = row.statements.map(inspectSql);
      if (!entries.some(entry => entry.kind === 'SQL')) throw new Error();
      const canonical = JSON.stringify(entries.flatMap(entry => entry.statements));
      return { row, checksum: createHash('sha256').update(canonical).digest('hex') };
    } catch { return { row, checksum: null }; }
  });
  const identity = rows.filter(x => x.row.version === version || x.row.name === name);
  if (identity.some(x => x.checksum === null)) return { file, version, checksum, result: 'UNKNOWN' };
  if (identity.some(x => x.checksum !== checksum)) return { file, version, checksum, result: 'MATERIAL_MISMATCH' };
  const equivalent = rows.find(x => x.checksum === checksum)?.row;
  return { file, version, checksum, result: equivalent ? 'ALREADY_EQUIVALENT' :
    rows.some(x => x.checksum === null) ? 'UNKNOWN' : 'PENDING',
    ...(equivalent ? { registered_version: equivalent.version } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, ledgerPath] = process.argv.slice(2);
  if (!directory || !ledgerPath) throw new Error('Usage: node deploy/migration-equivalence.mjs MIGRATIONS LEDGER_JSON');
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  if (!Array.isArray(ledger) || !ledger.every((row) => typeof row.version === 'string')) {
    throw new Error('Expected a read-only migration ledger JSON array');
  }
  const results = readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()
    .map((file) => compareMigration(file, readFileSync(resolve(directory, file), 'utf8'), ledger));
  console.info(JSON.stringify(results, null, 2));
  if (results.some((row) => ['MATERIAL_MISMATCH', 'UNKNOWN'].includes(row.result))) process.exitCode = 1;
}
