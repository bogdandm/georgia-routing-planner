begin;

select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'folder-one@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'folder-two@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

select has_table('public', 'track_folder_records', 'track folder records table exists');
select has_table('private', 'user_track_folder_sync_state', 'private folder state table exists');
select has_function('public', 'upsert_track_folder', array['uuid', 'text', 'jsonb', 'bigint']);
select has_function('public', 'delete_track_folder', array['uuid', 'text', 'bigint']);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.track_folder_records'::regclass),
  'track folder records enable row-level security'
);
select table_privs_are('public', 'track_folder_records', 'authenticated', array['SELECT'], 'authenticated users can only select folder records directly');
select table_privs_are('private', 'user_track_folder_sync_state', 'service_role', array[]::text[], 'service role has no direct private-state access');
select function_privs_are('public', 'upsert_track_folder', array['uuid', 'text', 'jsonb', 'bigint'], 'authenticated', array[]::text[], 'authenticated users cannot invoke folder upserts directly');
select results_eq(
  $$ select record_count, next_revision from private.user_track_folder_sync_state where user_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (0::integer, 1::bigint) $$,
  'new auth users receive folder synchronization state'
);

select is(
  public.upsert_track_folder(
    '11111111-1111-1111-1111-111111111111',
    'imports',
    '{"schemaVersion":1,"id":"imports","name":"Imports","normalizedName":"imports","iconKey":"folder","position":0,"createdAt":"2026-09-28T00:00:00.000Z","updatedAt":"2026-09-28T00:00:00.000Z"}'::jsonb,
    0
  ) ->> 'outcome',
  'applied', 'new folder upsert applies'
);
select is(
  public.upsert_track_folder(
    '11111111-1111-1111-1111-111111111111',
    'imports',
    '{"schemaVersion":1,"id":"imports","name":"Stale","normalizedName":"stale","iconKey":"folder","position":0,"createdAt":"2026-09-28T00:00:00.000Z","updatedAt":"2026-09-28T00:00:00.000Z"}'::jsonb,
    0
  ) ->> 'outcome',
  'conflict', 'stale folder upsert conflicts'
);
select is(
  public.delete_track_folder('11111111-1111-1111-1111-111111111111', 'imports', 0) ->> 'outcome',
  'conflict', 'stale folder deletion conflicts'
);
select is(
  public.delete_track_folder('11111111-1111-1111-1111-111111111111', 'imports', 1) ->> 'outcome',
  'applied', 'matching folder deletion applies'
);
select is(
  public.delete_track_folder('11111111-1111-1111-1111-111111111111', 'imports', 1) ->> 'outcome',
  'applied', 'missing folder deletion is idempotent'
);
select is(
  public.upsert_track_folder(
    '11111111-1111-1111-1111-111111111111',
    'imports',
    '{"schemaVersion":1,"id":"imports","name":"Imports","normalizedName":"imports","iconKey":"folder","position":0,"createdAt":"2026-09-28T00:00:00.000Z","updatedAt":"2026-09-28T00:00:00.000Z"}'::jsonb,
    0
  ) -> 'record' ->> 'revision',
  '2', 'delete and recreate receives a monotonic revision'
);
select is(
  public.upsert_track_folder('11111111-1111-1111-1111-111111111111', 'missing', '{"id":"missing"}'::jsonb, 1) ->> 'outcome',
  'missing', 'positive-base upsert of a missing folder is reported'
);
select throws_ok(
  $$ select public.upsert_track_folder('11111111-1111-1111-1111-111111111111', 'imports', '{"id":"other"}'::jsonb, 2) $$,
  'P0001', 'invalid track folder upsert', 'payload identity mismatch is rejected before mutation'
);

update private.user_track_folder_sync_state
set record_count = 1000
where user_id = '11111111-1111-1111-1111-111111111111';
select is(
  public.upsert_track_folder('11111111-1111-1111-1111-111111111111', 'limited', '{"id":"limited"}'::jsonb, 0) ->> 'outcome',
  'limit', 'new folders respect the account limit'
);

select is(
  public.upsert_track_folder('22222222-2222-2222-2222-222222222222', 'private', '{"id":"private"}'::jsonb, 0) ->> 'outcome',
  'applied', 'second owner folder upsert applies'
);
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select is((select count(*) from public.track_folder_records), 1::bigint, 'RLS exposes only the authenticated owner folders');
select throws_ok(
  $$ insert into public.track_folder_records (user_id, folder_id, payload, revision) values ('11111111-1111-1111-1111-111111111111', 'direct', '{"id":"direct"}'::jsonb, 1) $$,
  '42501', null, 'authenticated direct folder writes are denied'
);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select is((select count(*) from public.track_folder_records), 1::bigint, 'RLS hides the first owner folders from the second owner');
reset role;

select * from finish();
rollback;
