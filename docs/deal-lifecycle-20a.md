# Deal lifecycle — staging 20A

Creation is enforced in `guard_deal_lifecycle`, not a client convention. Every
INSERT (including service-role automations) selects the first non-loss stage by
`position ASC, id ASC`. A supplied stage/title is ignored; missing NOT NULL
stage/title values are filled before constraints run. No normal stage produces
`pipeline_has_no_normal_stage`. Contact is mandatory for new deals; deleted
contacts remain nullable on historical deals. Creation never invokes the stage
RPC or creates an outbox intent, even with a mapped initial stage.

`deals.title` remains for schema compatibility and is overwritten on every deal
write with `contacts.name`. It is not displayed or editable. Kanban/form use the
current contact relation/list; contact and inbox lists use the current contact.
Kanban/form subscribe to account-scoped contact changes; focus refresh is a
fallback on the board. A contact rename is not pinned to the compatibility copy.

## Technical loss and backfill

`pipeline_stages.is_lost_stage` identifies loss independently of names/language.
Pipeline INSERT creates one loss stage under the existing admin/owner RLS.
A partial unique index allows at most one; deferred constraint triggers require
exactly one while the parent exists. Deleting a pipeline still cascades safely.
Stage identity/pipeline and pipeline account are immutable. An invoker trigger
sets loss `position = max(normal positions) + 1`, serializing writers on the
pipeline row. UI additionally sorts technical loss last. Mapping is constrained
to NULL; the UI cannot map/delete/reorder the technical row. The existing normal
mapping uniqueness and conversion milestone uniqueness are unchanged.

The new migration reuses a stage only when there is exactly one trimmed,
case-insensitive name matching `Venda perdida` or `Lost sale`, AND it is unmapped.
Ambiguous names/mapped stages are left untouched; a distinct technical row is
created. Historical `status=lost` deals and deals in a reused loss stage get
`other` as their unknown historical reason, not a fabricated specific reason.
Existing active deals/stages, frozen attribution, and conversion events are not
rewritten. Staging's previously named `TESTE META CAPI` is currently `Comercial`;
that user rename is preserved.

## Atomic loss/reopening

Stable reason codes: `price`, `no_interest`, `no_budget`, `no_response`,
`competitor`, `unavailable`, `bad_timing`, `unqualified`, `other`.
Notes are optional, trimmed on the RPC, at most 4000 characters. Labels are
translated in pt-BR/en/ko. DnD, stage selection, and Mark lost defer ALL writes
until Confirm loss. Cancel/escape/backdrop do not call the save/move callbacks.

The existing service-only `move_deal_to_stage_with_conversion_intent` takes two
optional loss arguments. There is no overloaded/parallel mutation RPC.
It validates reason before the same-stage shortcut or any write; loss stage,
status, reason and notes are persisted in one transaction. The same-stage path
allows reason edits without conversions. Regular detail edits retain the
existing form write flow; its stage/reason mutation is always the central RPC.
Browser direct writes of stage/reason are rejected with
`stage_move_requires_central_rpc`; the agent-gated route uses authenticated
server account context and a service-role repository. All relationship checks
remain account/pipeline scoped, including contact/conversation. All new trigger
functions are SECURITY INVOKER, empty search_path, not public RPC endpoints.

Loss sets existing `status=lost`; leaving it sets `status=open`. Explicit won
status on normal stages keeps its existing behavior. Won cannot override loss
without reopening. With no structured status history, last reason/notes remain
stored on reopen as historical data but are hidden while the deal is normal.
Re-loss requires confirmation again and replaces that last reason. Loss never
freezes/replaces attribution or creates an intent. Reentry into a mapped normal
stage retains the existing unique account+deal+event_name protection. No sender,
certainty, hashing, redirect protection or scheduler implementation is changed.

## Verification and deployment boundaries

Actual PostgreSQL/PGlite tests execute migrations 040/041 and the new migration,
including constraints, RLS roles, server-side creation, loss/reopen and conversion
dedupe. DOM tests execute the form/board confirmation/cancel callbacks; DnD
transport and Supabase are mocked, never real Meta. Test-only dependencies are
pinned, not imported into runtime application code. Scheduler tests remain a
separate Node suite.

Deployment is staging-only, with its scheduler config/image/120000ms interval
unchanged. Structural staging tests run in a rollback transaction with a new
isolated pipeline whose normal stage has no mapping, never the real deal's
mapped stages. The scheduler cannot see uncommitted fixtures. No manual cron or
real CAPI event is authorized. Compare all seven historical events' status,
attempts, timestamps (and complete rows in SQL) before and after deployment.

Preexisting generated `.next/types/* 2.ts` duplicates broke local typecheck;
the generated directory was moved recoverably to
`/tmp/wacrm-20a-generated-xtO2AN/next-before-20a`, and rebuilt. CLI temp files
generated during migration creation were moved alongside it. No source was
deleted. The remote checkout's unrelated auth edits are preserved via a detached
build worktree.

Security advisors before migration report preexisting findings outside this
stage: mutable search_path legacy functions, public vector extension, old
executable SECURITY DEFINER functions, disabled leaked-password protection,
and a service-only automation table with no browser policy. Do not expand this
change into a general security migration. Remediation references:
[function privileges](https://supabase.com/docs/guides/database/functions#function-privileges),
[database linter](https://supabase.com/docs/guides/database/database-linter),
[password security](https://supabase.com/docs/guides/auth/password-security).

Existing build warnings (workspace lockfile inference, middleware deprecation,
edge static generation) and existing lint warnings are documented, not fixed
with unrelated changes. npm reports preexisting dependency advisories; no
out-of-scope automatic upgrade/audit fix is applied.

Local verification: 98 added tests, full Vitest suite 108 files / 1235 tests PASS;
separate scheduler 12/12 PASS; typecheck/build PASS; lint 0 errors / the existing
37 warnings. The CAPI sender, transport, customer hashing, scheduler and
historical migrations have zero diff.
