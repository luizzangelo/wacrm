import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export const DEFAULT_INTERVAL_MS = 120_000;
export const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 2_147_483_647; // Node timer limit; avoid overflow to 1ms.

export function resolveCronIntervalMs(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
    return DEFAULT_INTERVAL_MS;
  }
  const interval = Number(value.trim());
  return Number.isSafeInteger(interval)
    && interval >= MIN_INTERVAL_MS && interval <= MAX_INTERVAL_MS
    ? interval
    : DEFAULT_INTERVAL_MS;
}

export const DEFAULT_TIMEOUT_MS = 70_000;

export function resolveCronTimeoutMs(value) {
  const timeout = typeof value === 'string' && /^\d+$/.test(value.trim())
    ? Number(value.trim()) : NaN;
  return Number.isSafeInteger(timeout) && timeout >= 1_000 && timeout <= 70_000
    ? timeout : DEFAULT_TIMEOUT_MS;
}

export function resolveSchedulerConfig(env = process.env) {
  // Loopback default cannot accidentally target another environment or send
  // the secret to a public server. Separate-container deployments set the URL.
  let endpoint = null;
  try {
    const url = new URL(env.META_CONVERSIONS_APP_URL ?? 'http://127.0.0.1:3000');
    const internalHost = /^(?:[a-z_][a-z0-9_-]*|localhost|127\.0\.0\.1)$/.test(url.hostname)
      || /^(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname);
    if (['http:', 'https:'].includes(url.protocol) && internalHost &&
      !url.username && !url.password && !url.search && !url.hash && url.pathname === '/') {
      endpoint = new URL('/api/meta-conversions/events/cron', url).href;
    }
  } catch { /* Invalid explicit configuration fails closed. */ }
  const secretPath = env.META_CONVERSIONS_CRON_SECRET_PATH ?? '/run/secrets/automation_cron_secret';
  return Object.freeze({
    endpoint,
    secretPath: /^\/run\/secrets\/[a-zA-Z0-9_-]+$/.test(secretPath) ? secretPath : null,
    intervalMs: resolveCronIntervalMs(env.META_CONVERSIONS_CRON_INTERVAL_MS),
    timeoutMs: resolveCronTimeoutMs(env.META_CONVERSIONS_CRON_TIMEOUT_MS),
  });
}

const CONFIG = resolveSchedulerConfig();
export const INTERVAL_MS = CONFIG.intervalMs;
export const REQUEST_TIMEOUT_MS = CONFIG.timeoutMs;
export const ENDPOINT = CONFIG.endpoint;
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
  config = CONFIG,
  fetcher = fetch,
  readSecret = () => readFileSync(config.secretPath, 'utf8'),
} = {}) {
  if (!config.endpoint || !config.secretPath) {
    return { http_status: null, outcome: 'configuration_unavailable' };
  }
  let secret;
  try {
    secret = readSecret().trim();
    if (!secret) throw new Error('missing');
  } catch {
    return { http_status: null, outcome: 'secret_unavailable' };
  }

  try {
    const response = await fetcher(config.endpoint, {
      method: 'GET',
      headers: { 'x-cron-secret': secret },
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeoutMs),
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
  intervalMs = INTERVAL_MS,
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
      interval_ms: intervalMs,
      ...result,
    });
    heartbeat();
    if (keepRunning()) {
      // Sequential await + one replica: no overlapping requests. Cadence is
      // start-to-start, including request time, not sleep-after-completion.
      await wait(Math.max(1, intervalMs - (now() - started)));
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
