import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENDPOINT, INTERVAL_MS, REQUEST_TIMEOUT_MS,
  runOnce, runScheduler, sanitizedCounts,
} from './meta-conversions-scheduler.mjs';

const idle = {
  scanned: 0, sent: 0, failed: 0, delivery_unknown: 0,
  skipped_disabled: 0, skipped_no_attribution: 0,
  skipped_missing_config: 0, errors: 0,
};

test('authenticated internal GET, strict redirects, timeout and safe idle log', async () => {
  let calls = 0;
  const result = await runOnce({
    readSecret: () => ' fictitious-secret\n',
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, ENDPOINT);
      assert.equal(options.method, 'GET');
      assert.equal(options.headers['x-cron-secret'], 'fictitious-secret');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      return { status: 200, json: async () => ({ ...idle, token: 'private-value' }) };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.http_status, 200);
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 0);
  assert.ok(!JSON.stringify(result).includes('private-value'));
  assert.ok(!JSON.stringify(result).includes('fictitious-secret'));
  assert.equal(INTERVAL_MS, 120_000);
  assert.ok(REQUEST_TIMEOUT_MS < INTERVAL_MS);
});

test('transport failure is never retried or logged verbatim', async () => {
  let calls = 0;
  const result = await runOnce({
    readSecret: () => 'secret',
    fetcher: async () => { calls++; throw new Error('sensitive-error'); },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { http_status: null, outcome: 'request_failed' });
});

test('HTTP errors are never retried and raw body is never read', async () => {
  for (const status of [401, 429, 500]) {
    let calls = 0;
    const result = await runOnce({
      readSecret: () => 'secret',
      fetcher: async () => {
        calls++;
        return { status, json: () => { throw new Error('must not read'); } };
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, { http_status: status, outcome: 'http_error' });
  }
});

test('missing Docker secret prevents any HTTP request', async () => {
  const result = await runOnce({
    readSecret: () => { throw new Error('private-path'); },
    fetcher: () => { throw new Error('must not fetch'); },
  });
  assert.deepEqual(result, { http_status: null, outcome: 'secret_unavailable' });
});

test('only nonnegative numeric allowlisted counters can be logged', () => {
  const result = sanitizedCounts({ ...idle, scanned: 'phone', sent: -1, name: 'PII' });
  assert.equal(result.processed, null);
  assert.equal(result.sent, null);
  assert.ok(!JSON.stringify(result).includes('PII'));
  assert.ok(!JSON.stringify(result).includes('phone'));
});

test('two windows are sequential with 120-second start-to-start cadence', async () => {
  let clock = 0, calls = 0, active = 0, maxActive = 0;
  const starts = [], waits = [], reports = [];
  await runScheduler({
    now: () => clock,
    keepRunning: () => calls < 2,
    heartbeat: () => {},
    report: (entry) => reports.push(entry),
    run: async () => {
      starts.push(clock);
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      clock += 5_000;
      active--;
      calls++;
      return { http_status: 200, outcome: 'ok' };
    },
    wait: async (ms) => { waits.push(ms); clock += ms; },
  });
  assert.deepEqual(starts, [0, 120_000]);
  assert.deepEqual(waits, [115_000]);
  assert.equal(maxActive, 1);
  assert.equal(reports.length, 2);
});
