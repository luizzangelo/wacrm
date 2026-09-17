# Inbound deals and Kanban conversation context

## Rules

The existing UI has no explicit pipeline-default field. Automatic inbound uses
the oldest configured pipeline in the same account (`created_at ASC, id ASC`),
skipping pipelines without a normal stage. No pipeline is invented if none is
configured: inbound persists, with a generic warning and no auto deal. No
historical messages or deals are backfilled. A subsequent useful inbound can
create a deal after configuration is available.

A database AFTER INSERT trigger, within the message transaction, handles only
trusted service-role/admin customer messages with a WhatsApp message ID and
useful content (nonblank text or supported media/interactive/location). Reactions
remain short-circuited by the existing webhook. Agent/bot/status updates, browser
message writes and duplicate upserts do not create deals. Message insert failure
rolls back its deal too; no detached best-effort race.

An existing non-lost deal anywhere in the same account/contact suppresses auto
creation. This deliberately includes `won` in a normal stage, following the
requested definition. Existing context is not edited or reattributed. If all
deals are in technical loss stages, a new open deal is created; lost deals keep
their historical data. Account currency is used. The existing lifecycle guard
supplies first normal stage, contact-derived compatibility title, open status
and empty loss reason. Attribution remains unfrozen until a real mapped move.

Transaction-scoped advisory locks on the account/contact key serialize the
check/insert. A BEFORE trigger on all deal inserts/updates uses the same lock,
including manual creation and central stage movements. This is not a unique
constraint forbidding intentional manual duplicates. No Meta sender, movement
RPC, scheduler, certainty, hashes, intent snapshot or historical event is changed.

## Cards and tenant boundary

Cards display `contacts.name` once, a plain React-escaped latest-message preview
bounded to 240 characters, and the first customer message date in pt-BR
(America/Fortaleza). The compact date is at top right; missing dates/messages
have translated pt-BR/en/ko fallbacks. Media without caption uses a generic
attachment label, never the media URL. Value, status, close date, assignee and
drag/edit behavior remain. Closedate keeps its date-only UTC interpretation.

One batched SECURITY INVOKER/STABLE read-only RPC resolves explicit conversations
only if account and contact match. Unlinked deals resolve the most recent contact
conversation; registration is the first inbound across that contact's account
conversations. An invalid explicit link is not silently replaced with another
conversation. All underlying RLS remains in force, including viewer read access.
No names, phones, emails, credentials or message text are logged by new code.
Contact/deal/conversation changes and focus refresh card data. Deals are added to
the existing Realtime publication only if not already present.

## Validation

Tests execute the exact new migration together with 040/041/20A in isolated
PostgreSQL/PGlite. DOM tests cover the actual card; existing webhook tests cover
inbound, replay, reaction and CTWA paths unchanged. No real WhatsApp or Meta
requests occur. `supabase/tests/inbound_concurrency.sh` uses an isolated Postgres
16 Docker container (no network/ports, no staging credentials) to verify actual
overlapping transactions: inbound/inbound and manual/inbound, with zero intents.
The container is removed on completion; no persistent user data is removed.

Security advisors before this change have legacy findings documented in the 20A
report; no broad security remediation is included here. New functions are
SECURITY INVOKER, empty search_path; trigger helpers have no browser execution
grant, and the read-only summary RPC has only authenticated/service-role access.
References: [function privileges](https://supabase.com/docs/guides/database/functions#function-privileges),
[database linter](https://supabase.com/docs/guides/database/database-linter).

Local verification: 59 new tests; full suite 111 files / 1295 tests PASS,
scheduler 12/12 PASS, lint 0 errors / 36 preexisting warnings, typecheck/build
PASS and git diff --check PASS. The first prebuild typecheck found duplicate
generated `.next/types/* 2.ts` files; Next build regenerated its type directory,
and the subsequent standalone typecheck passed. No source was removed or
runtime dependency changed.

## Staging evidence — 2026-09-17

Code/image `4392448` built successfully (Docker digest
`sha256:c3403ccc1f1da90342aed00919a146361adefa4ddb558f73f149b04042b3120c`).
The concurrency script passed on an isolated networkless Postgres 16 container:
overlapping inbound inserts produced one deal; manual/inbound overlap did not
duplicate the manual deal; conversion count remained zero. The temporary
container and clean detached build worktree were removed, not the dirty remote
auth checkout or any persistent data.

The migration was applied only to project `awganmhowivedfocwzjy`. Staging app
and scheduler are 1/1 and healthy. The app is `wacrm-staging:4392448`; scheduler
image `65c593f`, config and task `nowi61qx7igu` are unchanged at 120000ms.
Login HTTP 200. The new summary RPC via runtime PostgREST returned HTTP 200 /
two rows; an anonymous request returned HTTP 401. New functions are invoker/
empty-search-path with expected grants. Security advisor findings are unchanged,
with no new function flagged. The existing Realtime publication contains deals.

Read-only comparison after migration/deploy: all seven complete historical event
rows match the baseline, six sent and one failed, no pending/sending events.
Attributions and Meta configuration digests match their baselines without
printing any values. Existing deal count remains two; no backfill occurred.
No manual cron, WhatsApp send, Graph API call or real POST /events was executed.
App logs since 05:13 UTC contain zero CAPI send entries.

Original manifest backup:
`/opt/wacrm-staging/stack.yml.before-inbound-20260917`.
Automatic scheduler executions at 05:23:44 and 05:25:44 UTC both returned
HTTP 200, processed=0. The final read-only comparison after both executions
again confirmed identical historical events, attributions and Meta configuration.

## Card reply indicator and registration time

Cards now show registration date plus HH:mm in America/Fortaleza, not the last
message time. A rounded bordered preview bubble and an 8px `bg-primary` dot use
the inbox theme. The dot means latest stored conversation message sender is
`customer`, independently of read/unread or delivery status. It disappears when
the latest sender is agent/bot; missing summaries/senders show no dot. Accessible
tooltip/label is translated in pt-BR/en/ko. The batch invoker RPC adds only
`last_message_sender_type`, with unchanged RLS and grants, in a new transactional
migration. No inbound, auto-deal, movement, CAPI or scheduler logic is changed.

Sixteen added tests cover sender/status behavior, removal after response, bubble
border, date/hour/minute and midnight/day rollover. Full suite 1311 PASS; lint
0 errors/36 preexisting warnings, build PASS; no runtime dependency change.
