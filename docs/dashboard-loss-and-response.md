# Dashboard loss occurrences and first response (20B)

## Metric and historical boundary

There was no reliable loss timestamp/stage history in the existing schema.
`deals.updated_at` changes on unrelated edits. `deal_loss_events` therefore stores
one immutable reason/timestamp snapshot on each **real non-lost → lost stage
transition**, in an AFTER UPDATE trigger in the existing move transaction.
The central stage/conversion RPC is unchanged. Retries and same-stage reason edits
do not append history; reopening preserves it and a subsequent loss appends a new
occurrence. The reason is the reason **at the transition**, not later edits.

No old deals are backfilled: their historical dates cannot be proven. The chart
starts collecting reliable occurrences when this migration is applied. Deal,
pipeline and stage UUIDs are historical snapshots, intentionally without cascading
foreign keys; deleting these operational rows does not erase counts. Account
deletion removes its history. No contact fields or private notes are snapshotted.

The invoker/RLS `dashboard_loss_reasons` RPC aggregates on the server and returns
exactly nine codes/counts, including zeros. An account/time covering index supports
range/group queries. Browser roles have tenant-scoped SELECT only; no mutation
grants. The trusted move transaction can INSERT; not UPDATE/DELETE.

## Calendar and first response

The CRM currently has no account timezone column. These new RPCs default explicitly
to the same `America/Fortaleza` timezone as CRM registration cards, independently
of browser/server timezone. SQL also accepts a validated IANA timezone for future
account settings. Loss periods: local day / Sunday-start calendar week / calendar
month through now. The UI defaults to month, refetches on every selection, and
discards stale replies. There is no fabricated-zero success state on query errors.

First response is the first unanswered **customer burst → first successfully
dispatched agent/bot response**. Bot replies remain included as in the original
business rule. Failed/pending outbound messages and system/reactions do not count.
Complete preceding conversation context prevents clipping a pending burst at the
reporting-window boundary. Stable created_at/id ordering resolves ties.

Only the current calendar week's observations populate Sunday–Saturday bars, by
the inbound local day. Both week summaries average individual observations, not
daily averages. A previous-week inbound answered this week belongs to last week's
summary. Unanswered messages do not count. The server returns seven aggregate rows,
avoiding the previous unpaginated message query's Data API row limit.

Minutes are consistent in SQL, data, bars, summaries and the 5-minute target.
The original `toFixed(1) + 'm'` collapses positive subminute axis ticks to repeated
`0.0m` (reproduced in real-Recharts DOM regression test). It also displayed hours as
large decimal minutes. No evidence establishes a milliseconds→minutes unit bug;
the separate proven inconsistencies were mixed two-week bars vs weekly summaries,
Monday-first hardcoded English labels, browser-dependent boundaries, and counting
any outbound even if failed. Numeric explicit ticks + seconds/minutes/hours display
fix presentation without claiming that 624 minutes itself rounds to zero.

No-sample days remain null (not zero response time); a fully empty current week
uses the existing empty state. Actual zero observations retain a stable chart.
Localized labels/durations support pt-BR, en and ko. Both charts use the existing
Recharts library, full-width cards, semantic dark/light colors, and internal
horizontal scrolling; loss labels wrap without truncation.

## Verification and staging

Database tests run only in isolated PGlite/PostgreSQL. Real staging deals are not
moved for validation. Read-only aggregate calls and before/after Meta event/config
snapshots verify deployment without cron or CAPI calls. Existing advisor findings
must not be confused with new migration regressions.

### Deployment evidence — 2026-09-17

- Implementation commit/image: `50f56c5` / `wacrm-staging:50f56c5`.
- Migration applied successfully to staging. Both RPCs are invoker functions with
  an empty search path; security-advisor finding counts are unchanged.
- 75 new tests; full suite: 115 files / 1,386 tests passing. Scheduler: 12/12.
  Typecheck, local Next build, Docker build and diff checks pass. Lint has zero
  errors and 36 pre-existing warnings.
- Disposable real PostgreSQL 16 concurrency tests pass: simultaneous loss moves
  create one occurrence, reopening and losing again creates another, and no
  conversion intents are generated. The disposable container is removed by the
  test script; no staging deal is moved for these checks.
- Authenticated staging UI: both cards load, loss filters Day/Week/Month work,
  Portuguese labels and Sunday-first weekdays render, and both light/dark themes
  are legible. The original light theme is restored. At 400 px, the response card
  wraps its summaries and limits horizontal scrolling to the chart. Loss-chart
  responsive structure and wrapping are additionally covered by DOM tests.
- Current response summary is 17h 13min (three successful-response samples);
  previous week has no samples and displays a dash. Axis uses explicit duration
  ticks, not repeated decimal-minute zero labels.
- App is 1/1 and healthy. Scheduler remains 1/1 on its original task/image
  `65c593f`, interval 120 seconds; automatic executions return HTTP 200 and process
  zero events. No manual cron is called.
- All eight historical Meta conversion event rows are byte-for-byte unchanged;
  config and attribution fingerprints are unchanged. Attributions: two; pending:
  zero; sending: zero; loss occurrences: zero. No real CAPI POST is made by this
  task. No production or Meta configuration is changed.
- The remote original checkout's pre-existing password-recovery changes are
  preserved. Docker is built from a separate clean, disposable worktree.

### Changed files

```text
deploy/staging/README.md
deploy/staging/stack.yml
docs/dashboard-loss-and-response.md
messages/en.json
messages/ko.json
messages/pt-BR.json
src/app/(dashboard)/dashboard/page.tsx
src/components/dashboard/dashboard-bar-chart.tsx
src/components/dashboard/dashboard-charts.test.tsx
src/components/dashboard/loss-reasons-chart.tsx
src/components/dashboard/response-time-chart.tsx
src/hooks/use-dashboard-loss-reasons.ts
src/lib/dashboard/chart-format.test.ts
src/lib/dashboard/chart-format.ts
src/lib/dashboard/dashboard-database.test.ts
src/lib/dashboard/queries.test.ts
src/lib/dashboard/queries.ts
src/lib/dashboard/types.ts
src/lib/deals/inbound-database.test.ts
supabase/migrations/20260917054725_dashboard_loss_history_and_response_metrics.sql
supabase/tests/inbound_concurrency.sh
```
