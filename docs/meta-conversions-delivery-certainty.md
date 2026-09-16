# Delivery certainty / zero automatic retry — audit 19C

Scope: CAPI conversion events, not the separate attribution enrichment worker.
Tests use fictitious data and mocked HTTP, except two native-fetch redirect
regressions using an ephemeral loopback server. No Meta request, staging event
creation or manual real cron is required.

## State machine

| State | Automatic selection / transition |
| --- | --- |
| pending, attempts=0 | Selected oldest-first; preflight, then conditional claim |
| pending, attempts>0 | Quarantined to delivery_unknown before HTTP; attempts unchanged |
| sending | Not selected; stale after the 30s lease becomes delivery_unknown |
| sent | Terminal, not selected, direct worker invocation returns ignored |
| failed | Terminal, not selected, direct worker invocation returns ignored |
| delivery_unknown | Terminal, not selected, never returned to pending |
| skipped_disabled / skipped_no_attribution / skipped_missing_config | Terminal, no automatic retry |

Preflight checks config presence, enabled, frozen attribution with original
CTWA/WABA, valid persisted event snapshot, and token availability. Skips and
local failures consume no attempt. Every HTTP attempt requires a successful
claim first. The claim writes sending and attempts=expectedAttempts+1 using one
UPDATE filtered by id, account_id, status=pending and attempts=expectedAttempts,
with RETURNING id. A loser gets no row and does not call HTTP.

The read before claim is not the concurrency boundary: PostgreSQL's conditional
UPDATE is. Persistence is likewise filtered by sending and the claimed attempt.
If the process or result write fails after POST, the row remains sending until
the next batch quarantines it; it is never reset to pending.

Stage reentry is independently guarded by the unique account/deal/event_name
constraint and deterministic event_id. Event_id does not make ambiguous remote
delivery safe to retry. No event-reset API was found in this implementation.

## Response classification

| Response / failure | Stored state |
| --- | --- |
| 2xx, positive numeric events_received, no error | sent, attempts=1, sent_at set |
| 400 deterministic invalid parameter | failed, attempts=1, sent_at null |
| 401/403 deterministic authentication/authorization rejection | failed; rejected by HTTP 4xx, no retry |
| 429, or known Graph rate-limit code even under 400 | delivery_unknown |
| 500/502/503/504 | delivery_unknown |
| AbortError / TimeoutError after request begins | delivery_unknown |
| Network rejection / connection reset | delivery_unknown |
| 2xx missing/zero receipt, contradictory error envelope | delivery_unknown |
| Invalid/nonobject JSON on 2xx or 5xx | delivery_unknown |
| Invalid JSON on deterministic non-rate-limit 4xx | failed based on HTTP rejection |
| HTTP redirect | delivery_unknown; never followed/replayed |

A local regression proved an actual transport hole before correction: native
fetch follows 307/308 by default and issued two loopback POSTs for one claim.
`redirect: 'error'` now prevents that second POST. Redirect rejection uses the
existing ambiguous-network classification; no state/retry/claim semantics changed.

## Test evidence and limits

The sender is tested with the real response classifier and mocked fetch for
200, 400, 401, 403, 429, 500, 502, 503, 504, timeouts, ECONNRESET, incomplete 2xx,
invalid JSON and contradictory confirmation. Each terminal result is followed
by another batch: scanned=0, no extra POST, attempts remains 1.

A mixed pending/sent/failed/delivery_unknown fleet sends only pending. Two
concurrent async workers sharing a conditional in-memory repository have exactly
one claim winner and one mocked HTTP POST. Independent production-repository
tests assert all SQL/PostgREST claim predicates and selection filters. This is
CAS behavior coverage, not a live PostgreSQL concurrency/load test. Failure of
result persistence and stale recovery are covered without a second request.

The cron returns HTTP 200 with failed/delivery_unknown counters when the batch
completed normally. This is not confirmation of event delivery. The scheduler
does not interpret those counters as retry requests; it makes a single call per
120s window, awaits completion, and does not retry immediately after HTTP errors.

## Observability

Database audit fields retain event_id, event_name, status, attempts,
meta_http_status, sanitized Meta code/subcode and timestamps. Docker adds a
timestamp to the sender's result log, whose allowlisted fields are account/event
identifiers, event_name, attempt, HTTP status, numeric Meta codes and result.
No customer values, PII hashes, CTWA ID, token, Authorization or payload are logged.

`event_time` is intent time, not attempt-start time. `updated_at` is claim time
while in sending and result/recovery time afterward. A dedicated immutable
attempt-start timestamp is not persisted; after a crash before any result log,
the exact original start cannot be reconstructed from the recovered row alone.
This observability limitation does not enable retry or duplicate delivery.
No alerting system or schema migration is introduced in 19C.
