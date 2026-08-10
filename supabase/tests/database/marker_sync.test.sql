begin;

select no_plan();
create extension if not exists dblink;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'marker-one@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'marker-two@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

select has_table('public', 'marker_records', 'marker records table exists');
select has_table('private', 'user_marker_sync_state', 'private marker state table exists');
select has_function('public', 'upsert_marker', array['uuid', 'text', 'jsonb', 'bigint']);
select has_function('public', 'delete_marker', array['uuid', 'text', 'bigint']);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.marker_records'::regclass),
  'marker records enable row-level security'
);
select table_privs_are('public', 'marker_records', 'authenticated', array['SELECT'], 'authenticated users can only select marker records directly');
select table_privs_are('private', 'user_marker_sync_state', 'service_role', array[]::text[], 'service role has no direct private-state access');
select function_privs_are('public', 'upsert_marker', array['uuid', 'text', 'jsonb', 'bigint'], 'authenticated', array[]::text[], 'authenticated users cannot invoke marker upserts directly');

select is(
  public.upsert_marker('11111111-1111-1111-1111-111111111111', 'marker-a', jsonb_build_object('id', 'marker-a', 'name', 'A'), 0) ->> 'outcome',
  'applied', 'new marker upsert applies'
);
select is(
  (select revision from public.marker_records where user_id = '11111111-1111-1111-1111-111111111111' and marker_id = 'marker-a'),
  1::bigint, 'first marker revision is one'
);
select is(
  public.upsert_marker('11111111-1111-1111-1111-111111111111', 'marker-a', jsonb_build_object('id', 'marker-a', 'name', 'stale'), 0) ->> 'outcome',
  'conflict', 'base zero conflicts with an existing marker'
);
select is(
  public.delete_marker('11111111-1111-1111-1111-111111111111', 'marker-a', 0) ->> 'outcome',
  'conflict', 'stale marker deletion conflicts'
);
select is(
  public.delete_marker('11111111-1111-1111-1111-111111111111', 'marker-a', 1) ->> 'outcome',
  'applied', 'matching marker deletion applies'
);
select is(
  public.delete_marker('11111111-1111-1111-1111-111111111111', 'marker-a', 1) ->> 'outcome',
  'applied', 'missing marker deletion is idempotent'
);
select is(
  public.upsert_marker('11111111-1111-1111-1111-111111111111', 'marker-a', jsonb_build_object('id', 'marker-a', 'name', 'recreated'), 0) -> 'record' ->> 'revision',
  '2', 'delete and recreate receives a monotonic revision'
);
select is(
  public.upsert_marker('11111111-1111-1111-1111-111111111111', 'missing-marker', jsonb_build_object('id', 'missing-marker'), 1) ->> 'outcome',
  'missing', 'positive-base upsert of a missing marker is reported'
);
select results_eq(
  $$ select record_count, next_revision from private.user_marker_sync_state where user_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (1::integer, 3::bigint) $$,
  'conflict, missing, and idempotent delete leave counters unchanged'
);

update private.user_marker_sync_state set record_count = 10000 where user_id = '11111111-1111-1111-1111-111111111111';
select is(
  public.upsert_marker('11111111-1111-1111-1111-111111111111', 'limit-marker', jsonb_build_object('id', 'limit-marker'), 0) ->> 'outcome',
  'limit', 'new markers respect the account limit'
);
select is(
  (select next_revision from private.user_marker_sync_state where user_id = '11111111-1111-1111-1111-111111111111'),
  3::bigint, 'limit rejection does not consume a revision'
);

update private.user_marker_sync_state set record_count = 1, next_revision = 9007199254740992 where user_id = '11111111-1111-1111-1111-111111111111';
select is(
  public.upsert_marker('11111111-1111-1111-1111-111111111111', 'marker-a', jsonb_build_object('id', 'marker-a', 'name', 'exhausted'), 2) ->> 'outcome',
  'revision-exhausted', 'revision exhaustion rejects every upsert'
);
select results_eq(
  $$ select payload, revision from public.marker_records where user_id = '11111111-1111-1111-1111-111111111111' and marker_id = 'marker-a' $$,
  $$ values ('{"id":"marker-a","name":"recreated"}'::jsonb, 2::bigint) $$,
  'revision exhaustion leaves the existing marker unchanged'
);
select throws_ok(
  $$ select public.upsert_marker('11111111-1111-1111-1111-111111111111', 'marker-a', jsonb_build_object('id', 'other-marker'), 2) $$,
  'P0001', 'invalid marker upsert', 'payload identity mismatch is rejected before mutation'
);
select is(
  public.upsert_marker('22222222-2222-2222-2222-222222222222', 'marker-b', jsonb_build_object('id', 'marker-b'), 0) ->> 'outcome',
  'applied', 'second owner marker upsert applies'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select is((select count(*) from public.marker_records), 1::bigint, 'RLS exposes only the authenticated owner records');
select throws_ok(
  $$ insert into public.marker_records (user_id, marker_id, payload, revision) values ('11111111-1111-1111-1111-111111111111', 'direct-write', '{"id":"direct-write"}'::jsonb, 1) $$,
  '42501', null, 'authenticated direct marker writes are denied'
);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select is((select count(*) from public.marker_records), 1::bigint, 'RLS hides the first owner records from the second owner');
reset role;

create temporary table marker_race_outcomes (outcome text not null);
create temporary table marker_race_state (
  record_count integer not null,
  next_revision bigint not null
);

do $race$
begin
  perform dblink_connect('marker_race_setup', 'dbname=postgres');
  perform dblink_exec(
    'marker_race_setup',
    $sql$ insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'marker-race@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()) $sql$
  );
  perform dblink_connect('marker_race_one', 'dbname=postgres');
  perform dblink_connect('marker_race_two', 'dbname=postgres');
  perform dblink_send_query('marker_race_one', $sql$ select public.upsert_marker('33333333-3333-3333-3333-333333333333', 'race-marker', '{"id":"race-marker"}'::jsonb, 0) $sql$);
  perform dblink_send_query('marker_race_two', $sql$ select public.upsert_marker('33333333-3333-3333-3333-333333333333', 'race-marker', '{"id":"race-marker"}'::jsonb, 0) $sql$);
  insert into marker_race_outcomes
  select response::jsonb ->> 'outcome'
  from dblink_get_result('marker_race_one') as result(response text);
  insert into marker_race_outcomes
  select response::jsonb ->> 'outcome'
  from dblink_get_result('marker_race_two') as result(response text);
  insert into marker_race_state
  select record_count, next_revision
  from private.user_marker_sync_state
  where user_id = '33333333-3333-3333-3333-333333333333';
  perform dblink_exec('marker_race_setup', $sql$ delete from auth.users where id = '33333333-3333-3333-3333-333333333333' $sql$);
  perform dblink_disconnect('marker_race_one');
  perform dblink_disconnect('marker_race_two');
  perform dblink_disconnect('marker_race_setup');
exception
  when others then
    if 'marker_race_setup' = any(coalesce(dblink_get_connections(), array[]::text[])) then
      perform dblink_exec('marker_race_setup', $sql$ delete from auth.users where id = '33333333-3333-3333-3333-333333333333' $sql$);
    end if;
    if 'marker_race_one' = any(coalesce(dblink_get_connections(), array[]::text[])) then
      perform dblink_disconnect('marker_race_one');
    end if;
    if 'marker_race_two' = any(coalesce(dblink_get_connections(), array[]::text[])) then
      perform dblink_disconnect('marker_race_two');
    end if;
    if 'marker_race_setup' = any(coalesce(dblink_get_connections(), array[]::text[])) then
      perform dblink_disconnect('marker_race_setup');
    end if;
    raise;
end;
$race$;

select results_eq(
  $$ select outcome from marker_race_outcomes order by outcome $$,
  $$ values ('applied'::text), ('conflict'::text) $$,
  'concurrent base-zero upserts return applied and conflict rather than a uniqueness error'
);
select results_eq(
  $$ select record_count, next_revision from marker_race_state $$,
  $$ values (1::integer, 2::bigint) $$,
  'concurrent base-zero upserts retain one record and one allocated revision'
);

select * from finish();
rollback;
