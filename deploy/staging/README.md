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
The liveness healthcheck checks a heartbeat, not confidential response content.
Counters in logs are allowlisted nonnegative integers only.

The app endpoint authenticates `x-cron-secret`, processes up to five pending
events sequentially, and uses an atomic conditional pending-to-sending claim.
Only the successful claim increments attempts. A stale sending event becomes
terminal delivery_unknown; sent/failed/delivery_unknown are not selected again.
Meta transport has a 10-second timeout per event; the route budget is 60 seconds.

Before deployment, confirm globally `pending=0` and `sending=0` read-only and
record existing events/status/attempts. After two automatic idle executions,
verify HTTP 200, processed/sent/failed=0, unchanged rows and no sender POST log.

## Deploy

Copy `stack.yml` and `meta-conversions-scheduler.mjs` to `/opt/wacrm-staging/`.
Back up its previous stack file first. Preserve the dirty application checkout.
The app image in this stack matches the already validated `65c593f` deployment;
future image upgrades must update both image references deliberately.

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
