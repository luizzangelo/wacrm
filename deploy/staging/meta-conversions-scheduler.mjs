import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export const INTERVAL_MS = 120_000;
export const REQUEST_TIMEOUT_MS = 70_000;
export const ENDPOINT =
  'http://wacrm_staging_app:3000/api/meta-conversions/events/cron';
const SECRET_PATH = '/run/secrets/wacrm_staging_automation_cron_secret';
const HEARTBEAT_PATH = '/tmp/meta-conversions-scheduler-heartbeat';

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function sanitizedCounts(body) {
  const input = body && typeof body === 'object' ? body : {};
  const skips = [
    input.skipped_disabled,
    input.skipped_no_attribution,
    input.skipped_missing_config,
  ].map(count);
  return {
    processed: count(input.scanned),
    sent: count(input.sent),
    failed: count(input.failed),
    delivery_unknown: count(input.delivery_unknown),
    skipped: skips.every((value) => value !== null)
      ? count(skips.reduce((sum, value) => sum + value, 0))
      : null,
    errors: count(input.errors),
  };
}

// Exactly one request per scheduled window; never retry a transport failure.
export async function runOnce({
  fetcher = fetch,
  readSecret = () => readFileSync(SECRET_PATH, 'utf8'),
} = {}) {
  let secret;
  try {
    secret = readSecret().trim();
    if (!secret) throw new Error('missing');
  } catch {
    return { http_status: null, outcome: 'secret_unavailable' };
  }

  try {
    const response = await fetcher(ENDPOINT, {
      method: 'GET',
      headers: { 'x-cron-secret': secret },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      return { http_status: response.status, outcome: 'http_error' };
    }
    const counts = sanitizedCounts(await response.json());
    return { http_status: 200, outcome: 'ok', ...counts };
  } catch {
    // Do not log exception messages, headers, raw responses or payloads.
    return { http_status: null, outcome: 'request_failed' };
  }
}

export async function runScheduler({
  run = runOnce,
  wait = sleep,
  now = Date.now,
  keepRunning = () => true,
  report = (entry) => console.info(JSON.stringify(entry)),
  heartbeat = () => writeFileSync(HEARTBEAT_PATH, String(Date.now())),
} = {}) {
  heartbeat();
  while (keepRunning()) {
    const started = now();
    const result = await run();
    report({
      timestamp: new Date(started).toISOString(),
      event: 'meta_conversions_scheduler',
      ...result,
    });
    heartbeat();
    if (keepRunning()) {
      // Sequential await + one replica: no overlapping requests. Cadence is
      // start-to-start, including request time, not sleep-after-completion.
      await wait(Math.max(1, INTERVAL_MS - (now() - started)));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScheduler().catch(() => {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'meta_conversions_scheduler',
      outcome: 'scheduler_failed',
    }));
    process.exitCode = 1;
  });
}
