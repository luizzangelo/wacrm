# Staging Meta Conversions scheduler

Staging only: `wacrm_staging`, `crm.luizangelo.com.br`. No production stack,
enrichment cron, Meta settings or event state changes are part of deployment.

The existing app image also contains Node, so a separate scheduler image is not
needed. A versioned Docker Config mounts the scheduler; only the existing cron
Docker Secret is granted to it. Secret contents are read into memory, never put
in ENV, command arguments, compose, the image or logs.

One replica performs an immediate GET, then another every 120 seconds
(start-to-start) over the internal overlay DNS `wacrm_staging_app:3000`.
The request times out after 70 seconds and does not follow redirects or retry.
Requests are awaited sequentially. Updates and rollbacks use stop-first.
The liveness healthcheck checks a heartbeat, not confidential response content,
using the validated interval + request timeout + 30 seconds as its age limit.
Counters in logs are allowlisted nonnegative integers only.

The app endpoint authenticates `x-cron-secret`, processes up to five pending
events sequentially, and uses an atomic conditional pending-to-sending claim.
Only the successful claim increments attempts. A stale sending event becomes
terminal delivery_unknown; sent/failed/delivery_unknown are not selected again.
Meta transport has a 10-second timeout per event; the route declares
`maxDuration=60`. This is deployment-platform metadata, not a guaranteed hard
deadline in self-hosted Next.js. Database/JSON/CPU overhead is additional.

## Frequency and capacity (19B)

`META_CONVERSIONS_CRON_INTERVAL_MS` is a nonsecret scheduler setting. Default:
120000; minimum: 60000. Only integer decimal strings within Node's timer limit
(2147483647ms) are accepted; missing/invalid/overflowing values use 120000.
Staging explicitly sets 120000. Initial production recommendation is also two
minutes; this file neither deploys nor configures production.

This is a start-to-start target, not 120 seconds after the response and not an
absolute wall-clock cron. After completion it waits the remaining interval;
overruns delay the next start, without parallel requests or missed-window
catch-up. The timeout remains 70s; worker claim/delivery semantics are unchanged.

| Interval | Waiting until next start, idle/no backlog | Calls/hour | Mathematical ceiling | Relative calls |
| --- | --- | --- | --- | --- |
| 1 minute | approximately 0–60s | 60 | 300 events/hour | 2x |
| 2 minutes | approximately 0–120s | 30 | 150 events/hour | 1x |
| 5 minutes | approximately 0–300s | 12 | 60 events/hour | 0.4x |

These are scheduling/capacity calculations, not measured delivery throughput.
Add processing/network/database time and backlog wait to those latency ranges.
With more than five pending events, the oldest five are selected and the rest
remain pending for the next automatic windows. At two minutes the batch's
approximately 50s Meta transport budget (5 × 10s) plus overhead has normal
headroom below 70s request timeout and 120s interval. There is no finite hard
execution bound established for database overhead.

All three intervals retain sequential anti-overlap and atomic worker claim.
One minute is not recommended initially because the 70s timeout can exceed its
cadence; two minutes preserves the existing successful idle cadence; five
minutes reduces request load but raises latency and lowers queue-drain capacity
without observed need. Idle success does not establish performance under backlog.

Before deployment, confirm globally `pending=0` and `sending=0` read-only and
record existing events/status/attempts. After two automatic idle executions,
verify HTTP 200, processed/sent/failed=0, unchanged rows and no sender POST log.

## Deploy

Copy `stack.yml` and `meta-conversions-scheduler.mjs` to `/opt/wacrm-staging/`.
Back up its previous stack file first. Preserve the dirty application checkout.
The app and scheduler now use `wacrm-staging:ed9ebd7`, accepted in stage 21G.
It preserves the previous CRM/CAPI features and adds SaaS tenant boundaries,
atomic onboarding and private Storage. Acceptance, exact image ID, migration
ledger equivalence and safe rollback constraints are documented in
`docs/saas-tenant-hardening-21g.md`. The scheduler script remains supplied by
the versioned Docker Config; its interval remains 120s and claims are unchanged.
App and scheduler image upgrades are independent and must be explicit.
The old public avatar CDN cache was invalidated once, without deleting its object.
Do not routinely rerun `21g_purge_legacy_avatar_cache.mjs`; read-only acceptance
can be checked with `21g_runtime_check.mjs` inside the existing app container.

On the staging VPS:

```sh
cd /opt/wacrm-staging
set -a
. ./public.env
set +a
docker stack deploy --resolve-image never -c stack.yml wacrm_staging
docker stack services wacrm_staging
docker service logs --timestamps wacrm_staging_meta_conversions_scheduler
```

When changing the scheduler source, create a new versioned Config name in the
stack, because Docker Configs are immutable. Do not use `--prune` for unrelated
stacks or scale the scheduler above one replica.

## Disable / rollback only the scheduler

```sh
docker service scale wacrm_staging_meta_conversions_scheduler=0
```

This leaves `wacrm_staging_app` and all database events untouched. Also set only
the scheduler's `deploy.replicas` to `0` in `/opt/wacrm-staging/stack.yml` and
the tracked stack file so a later stack deployment does not re-enable it.
Alternatively remove only the scheduler service block/config from the stack
file and run `docker service rm wacrm_staging_meta_conversions_scheduler`.
Never run `docker stack rm wacrm_staging` for a scheduler rollback.

Tests (no network or real secrets):

```sh
node --test deploy/staging/meta-conversions-scheduler.test.mjs
```
