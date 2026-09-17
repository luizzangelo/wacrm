// Read-only reconciliation. Never connects to a database or applies/repairs SQL.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const normalizeSql = (sql) => sql.replace(/\r\n/g, '\n').trim();
export const sqlChecksum = (sql) => createHash('sha256').update(normalizeSql(sql)).digest('hex');
export function compareMigration(file, sql, ledger) {
  const version = file.split('_')[0];
  const checksum = sqlChecksum(sql);
  const sameVersion = ledger.find((row) => row.version === version);
  const equivalent = ledger.find((row) => Array.isArray(row.statements) &&
    row.statements.length > 0 && row.statements.every((value) => typeof value === 'string') &&
    sqlChecksum(row.statements.join('\n')) === checksum);
  if (sameVersion && (!Array.isArray(sameVersion.statements) || !sameVersion.statements.length ||
    sqlChecksum(sameVersion.statements.join('\n')) !== checksum)) {
    return { file, version, checksum, result: 'BLOCKED_VERSION_SQL_MISMATCH' };
  }
  return { file, version, checksum, result: equivalent ? 'ALREADY_EQUIVALENT' : 'REVIEW_NOT_PROVEN',
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
  if (results.some((row) => row.result === 'BLOCKED_VERSION_SQL_MISMATCH')) process.exitCode = 1;
}
