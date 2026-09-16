import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENDPOINT, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS, REQUEST_TIMEOUT_MS,
  runOnce, runScheduler, sanitizedCounts, resolveCronIntervalMs,
} from './meta-conversions-scheduler.mjs';

const idle = {
  scanned: 0, sent: 0, failed: 0, delivery_unknown: 0,
  skipped_disabled: 0, skipped_no_attribution: 0,
  skipped_missing_config: 0, errors: 0,
};

test('HTTP cron errors retain normal cadence rather than immediate retry', async () => {
  for (const status of [401, 429, 500]) {
    let clock = 0, calls = 0;
    const starts = [];
    await runScheduler({
      intervalMs: DEFAULT_INTERVAL_MS,
      now: () => clock, keepRunning: () => calls < 2,
      heartbeat: () => {}, report: () => {},
      run: () => runOnce({
        readSecret: () => 'fictitious-secret',
        fetcher: async () => {
          starts.push(clock); calls++;
          return { status: calls === 1 ? status : 200, json: async () => idle };
        },
      }),
      wait: async (ms) => { clock += ms; },
    });
    assert.deepEqual(starts, [0, 120_000]);
    assert.equal(calls, 2);
  }
});

test('HTTP 200 failed/delivery_unknown counters never trigger an immediate retry', async () => {
  for (const state of ['failed', 'delivery_unknown']) {
    let clock = 0, calls = 0;
    const starts = [], reports = [];
    await runScheduler({
      intervalMs: DEFAULT_INTERVAL_MS,
      now: () => clock, keepRunning: () => calls < 2,
      heartbeat: () => {}, report: (entry) => reports.push(entry),
      run: () => runOnce({
        readSecret: () => 'fictitious-secret',
        fetcher: async () => {
          starts.push(clock); calls++;
          return { status: 200, json: async () => calls === 1
            ? { ...idle, scanned: 1, [state]: 1 } : idle };
        },
      }),
      wait: async (ms) => { clock += ms; },
    });
    assert.deepEqual(starts, [0, 120_000]);
    assert.equal(reports[0][state], 1);
    assert.equal(reports[1].processed, 0);
    assert.equal(calls, 2);
  }
});

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
  assert.equal(DEFAULT_INTERVAL_MS, 120_000);
  assert.ok(REQUEST_TIMEOUT_MS < DEFAULT_INTERVAL_MS);
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
    intervalMs: DEFAULT_INTERVAL_MS,
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
  assert.ok(reports.every((entry) => entry.interval_ms === 120_000));
});

test('interval defaults safely on missing, malformed, too small or overflowing values', () => {
  for (const value of [undefined, null, '', ' ', 'bad', 'NaN', 'Infinity',
    '0', '-60000', '59999', '60000.5', '6e4', '2147483648', '9007199254740993']) {
    assert.equal(resolveCronIntervalMs(value), DEFAULT_INTERVAL_MS);
  }
});

test('interval accepts minimum, staging default and five-minute cadence', () => {
  assert.equal(MIN_INTERVAL_MS, 60_000);
  for (const [value, expected] of [['60000', 60_000], ['120000', 120_000],
    [' 300000 ', 300_000], ['2147483647', 2_147_483_647]]) {
    assert.equal(resolveCronIntervalMs(value), expected);
  }
});

test('configured five-minute cadence is used by the actual scheduling loop', async () => {
  let clock = 0, calls = 0;
  const starts = [], waits = [];
  await runScheduler({
    intervalMs: resolveCronIntervalMs('300000'),
    now: () => clock,
    keepRunning: () => calls < 2,
    heartbeat: () => {}, report: () => {},
    run: async () => { starts.push(clock); clock += 1_000; calls++; return {}; },
    wait: async (ms) => { waits.push(ms); clock += ms; },
  });
  assert.deepEqual(starts, [0, 300_000]);
  assert.deepEqual(waits, [299_000]);
});

test('execution longer than a one-minute interval delays cadence without overlap', async () => {
  let clock = 0, calls = 0, active = 0, maxActive = 0;
  const starts = [];
  await runScheduler({
    intervalMs: resolveCronIntervalMs('60000'),
    now: () => clock,
    keepRunning: () => calls < 2,
    heartbeat: () => {}, report: () => {},
    run: async () => {
      starts.push(clock); active++; maxActive = Math.max(maxActive, active);
      await Promise.resolve(); clock += 70_000; active--; calls++; return {};
    },
    wait: async (ms) => { clock += ms; },
  });
  assert.deepEqual(starts, [0, 70_001]);
  assert.equal(maxActive, 1);
});
