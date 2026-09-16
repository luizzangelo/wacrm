# Meta Conversions observability

Settings → Meta Conversions → Conversion Events is an **admin/owner-only,
read-only** operational view. Its only request is GET
`/api/meta-conversions/events`; it never invokes the worker, Graph API or a
mutation. There are no resend/reset controls, including for terminal failures.

## Access and queries

The endpoint uses `requireRole('admin')`, the authenticated SSR/RLS client,
and explicit `account_id` predicates. Client-supplied account IDs are ignored.
Stage lookup is restricted to account-scoped readable pipelines and the page's
deal stage IDs. No service-role credential is used by this endpoint.

Pagination defaults to 20, max 50, ordered by created_at then id descending.
Status and event-name filters use closed vocabularies. Date filters apply to
created_at in UTC, with an inclusive final calendar day. Status counters use
indexed, account-scoped HEAD/count queries, not loading all event rows. They
are account totals, independent of list filters; parallel reads are not an
atomic snapshot and may differ briefly while the worker processes an event.

Contact lookup follows the frozen attribution, not the event's contact_id or
the current deal. Only the contact UUID is selected; the UI displays
`Contato · <first 8 UUID characters>`, never its name/email/phone. Deleted
deals display “Deal removido”. Pipeline and stage refer to the current deal,
not an immutable historical stage.

## Safe response boundary

The dedicated serializer emits only allowlisted fields. HTTP/error codes must
be nonnegative integers. Timestamp strings are parsed and canonicalized.
Persisted error text, Meta messages, raw responses and arbitrary event IDs
are never forwarded. Diagnostic messages come from a closed, controlled
vocabulary. Structurally valid internal event IDs are masked; invalid ones
use a generic mask. No ctwa_clid, credentials, PII or customer hashes are
included. Tests use a hostile fixture containing all these values.

Purchase value/currency come from the persisted event snapshot, not the
current deal. “Dataset atual” is explicitly the current configuration: the
schema does not persist a dataset ID per historical attempt.

## Delivery guarantees and time limits

Failed and delivery_unknown have different badges and explanations. Unknown
delivery warns that Meta may have received the event and that automatic
resending risks duplicate conversion. All terminal statuses remain untouched.

Sending age is calculated from updated_at using the existing worker lease
threshold, for display only. It updates when the list is refreshed. The stale
warning performs no recovery. Last update reflects claim while sending and
result/recovery after termination; it is **not an immutable attempt-start
timestamp**. Adding such a column is outside this read-only observability
change. Likewise, a local preflight failure can have attempts=0 and no HTTP
status: the safe diagnostic does not infer an HTTP request from status alone.

Tests cover the route authorization boundary, tenant predicates, pagination,
filters, ordering, deleted deals, snapshots, safe serialization and static
rendering with zero retry controls. No live delivery_unknown fixture, real
cron invocation or Meta POST is required for verification. The existing
scheduler and delivery state machine are unchanged.
