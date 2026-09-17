#!/bin/sh
# Run only against a fresh isolated Docker Postgres, never staging credentials.
set -eu
task_container="wacrm-inbound-concurrency-check"
if docker container inspect "$task_container" >/dev/null 2>&1; then
  echo 'Refusing to reuse an existing test container' >&2
  exit 1
fi
docker run --detach --name "$task_container" --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16 >/dev/null
trap 'docker rm -f "$task_container" >/dev/null' EXIT HUP INT TERM
task_ready=0
while ! docker exec "$task_container" pg_isready -U postgres >/dev/null 2>&1; do
  task_ready=$((task_ready + 1))
  if [ "$task_ready" -gt 30 ]; then echo 'Test Postgres not ready' >&2; exit 1; fi
  sleep 1
done
for task_sql in src/lib/deals/lifecycle-schema.fixture.sql src/lib/deals/inbound-schema.fixture.sql \
  supabase/migrations/040_meta_conversions_foundation.sql \
  supabase/migrations/041_meta_conversion_stage_outbox.sql \
  supabase/migrations/20260917035905_deal_initial_stage_and_loss.sql \
  supabase/migrations/20260917051426_inbound_deal_and_card_context.sql; do
  docker exec -i "$task_container" psql -U postgres -v ON_ERROR_STOP=1 -q < "$task_sql" >/dev/null
done

# Hold first message transaction's per-contact lock; wait for a guaranteed marker.
docker exec "$task_container" psql -U postgres -v ON_ERROR_STOP=1 -q -c "
BEGIN;
INSERT INTO messages(conversation_id,sender_type,message_id,content_text)
VALUES('60000000-0000-4000-8000-000000000001','customer','wamid.concurrent.first','Fixture');
SELECT pg_advisory_xact_lock(712340001);
SELECT pg_sleep(3);
COMMIT;" >/dev/null &
task_first=$!
task_ready=0
while [ "$(docker exec "$task_container" psql -U postgres -Atq -c "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=712340001 AND granted")" != '1' ]; do
  task_ready=$((task_ready + 1))
  if [ "$task_ready" -gt 30 ]; then echo 'Lock marker not reached' >&2; exit 1; fi
  sleep 0.1
done
docker exec "$task_container" psql -U postgres -v ON_ERROR_STOP=1 -q -c "
INSERT INTO messages(conversation_id,sender_type,message_id,content_text)
VALUES('60000000-0000-4000-8000-000000000001','customer','wamid.concurrent.second','Fixture');" >/dev/null &
task_second=$!
wait "$task_first"
wait "$task_second"
task_count=$(docker exec "$task_container" psql -U postgres -Atq -c 'SELECT count(*) FROM deals')
[ "$task_count" = '1' ] || { echo 'Concurrent inbound duplicated a deal' >&2; exit 1; }

# A concurrently committing manual insert uses the exact same lock boundary.
docker exec "$task_container" psql -U postgres -v ON_ERROR_STOP=1 -q -c "
BEGIN;
INSERT INTO deals(account_id,user_id,pipeline_id,contact_id)
VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002',
'20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
SELECT pg_advisory_xact_lock(712340002);
SELECT pg_sleep(3);
COMMIT;" >/dev/null &
task_first=$!
task_ready=0
while [ "$(docker exec "$task_container" psql -U postgres -Atq -c "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=712340002 AND granted")" != '1' ]; do
  task_ready=$((task_ready + 1))
  if [ "$task_ready" -gt 30 ]; then echo 'Manual lock marker not reached' >&2; exit 1; fi
  sleep 0.1
done
docker exec "$task_container" psql -U postgres -v ON_ERROR_STOP=1 -q -c "
INSERT INTO messages(conversation_id,sender_type,message_id,content_text)
VALUES('60000000-0000-4000-8000-000000000002','customer','wamid.concurrent.manual','Fixture');" >/dev/null &
task_second=$!
wait "$task_first"
wait "$task_second"
task_count=$(docker exec "$task_container" psql -U postgres -Atq -c 'SELECT count(*) FROM deals')
[ "$task_count" = '2' ] || { echo 'Manual/inbound race duplicated a deal' >&2; exit 1; }
task_events=$(docker exec "$task_container" psql -U postgres -Atq -c 'SELECT count(*) FROM meta_conversion_events')
[ "$task_events" = '0' ] || { echo 'Inbound created a conversion' >&2; exit 1; }
echo 'PASS: concurrent inbound and manual/inbound race; conversion events=0'
