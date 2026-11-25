begin;

select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'presets-one@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'presets-two@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

select has_table('public', 'hiking_time_preset_records', 'hiking time preset records table exists');
select has_function('public', 'upsert_hiking_time_presets', array['uuid', 'jsonb', 'bigint']);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.hiking_time_preset_records'::regclass),
  'hiking time preset records enable row-level security'
);
select table_privs_are('public', 'hiking_time_preset_records', 'authenticated', array['SELECT'], 'authenticated users can only select preset records directly');
select table_privs_are('public', 'hiking_time_preset_records', 'anon', array[]::text[], 'anonymous users cannot access preset records');
select table_privs_are('public', 'hiking_time_preset_records', 'service_role', array['SELECT'], 'service role reads preset records directly and writes through the RPC');
select function_privs_are('public', 'upsert_hiking_time_presets', array['uuid', 'jsonb', 'bigint'], 'authenticated', array[]::text[], 'authenticated users cannot invoke preset upserts directly');
select function_privs_are('public', 'upsert_hiking_time_presets', array['uuid', 'jsonb', 'bigint'], 'anon', array[]::text[], 'anonymous users cannot invoke preset upserts');
select function_privs_are('public', 'upsert_hiking_time_presets', array['uuid', 'jsonb', 'bigint'], 'service_role', array['EXECUTE'], 'service role invokes preset upserts');

select is(
  public.upsert_hiking_time_presets('33333333-3333-3333-3333-333333333333', '{"schemaVersion":1,"defaultPresetId":"standard","custom":[]}'::jsonb, 1),
  '{"outcome":"missing","record":null}'::jsonb, 'positive-base upsert without a record is missing'
);
select is(
  public.upsert_hiking_time_presets('33333333-3333-3333-3333-333333333333', '{"schemaVersion":1,"defaultPresetId":"standard","custom":[]}'::jsonb, 0),
  '{"outcome":"applied","record":{"revision":1,"payload":{"schemaVersion":1,"defaultPresetId":"standard","custom":[]}}}'::jsonb,
  'first preset upsert applies at revision 1'
);
select is(
  public.upsert_hiking_time_presets('33333333-3333-3333-3333-333333333333', '{"schemaVersion":1,"defaultPresetId":"other","custom":[]}'::jsonb, 0),
  '{"outcome":"conflict","record":{"revision":1,"payload":{"schemaVersion":1,"defaultPresetId":"standard","custom":[]}}}'::jsonb,
  'base-zero upsert over an existing record conflicts with the current record'
);
select is(
  public.upsert_hiking_time_presets('33333333-3333-3333-3333-333333333333', '{"schemaVersion":1,"defaultPresetId":"fast","custom":[]}'::jsonb, 1),
  '{"outcome":"applied","record":{"revision":2,"payload":{"schemaVersion":1,"defaultPresetId":"fast","custom":[]}}}'::jsonb,
  'matching base revision applies and increments the revision'
);
select is(
  public.upsert_hiking_time_presets('33333333-3333-3333-3333-333333333333', '{"schemaVersion":1,"defaultPresetId":"stale","custom":[]}'::jsonb, 1),
  '{"outcome":"conflict","record":{"revision":2,"payload":{"schemaVersion":1,"defaultPresetId":"fast","custom":[]}}}'::jsonb,
  'stale base revision conflicts with the current record'
);

select throws_ok(
  $$ select public.upsert_hiking_time_presets(null, '{}'::jsonb, 0) $$,
  'P0001', 'invalid hiking time presets upsert', 'null user is rejected'
);
select throws_ok(
  $$ select public.upsert_hiking_time_presets('33333333-3333-3333-3333-333333333333', '[]'::jsonb, 2) $$,
  'P0001', 'invalid hiking time presets upsert', 'non-object payload is rejected'
);
select throws_ok(
  $$ select public.upsert_hiking_time_presets('33333333-3333-3333-3333-333333333333', null, 2) $$,
  'P0001', 'invalid hiking time presets upsert', 'null payload is rejected'
);
select throws_ok(
  $$ select public.upsert_hiking_time_presets('33333333-3333-3333-3333-333333333333', '{}'::jsonb, -1) $$,
  'P0001', 'invalid hiking time presets upsert', 'negative base revision is rejected'
);
select throws_ok(
  $$ select public.upsert_hiking_time_presets('33333333-3333-3333-3333-333333333333', '{}'::jsonb, null) $$,
  'P0001', 'invalid hiking time presets upsert', 'null base revision is rejected'
);

select is(
  public.upsert_hiking_time_presets('44444444-4444-4444-4444-444444444444', '{"schemaVersion":1,"defaultPresetId":"standard","custom":[]}'::jsonb, 0) ->> 'outcome',
  'applied', 'second owner preset upsert applies'
);
update public.hiking_time_preset_records
set revision = 9007199254740991
where user_id = '44444444-4444-4444-4444-444444444444';
select is(
  public.upsert_hiking_time_presets('44444444-4444-4444-4444-444444444444', '{"schemaVersion":1,"defaultPresetId":"fast","custom":[]}'::jsonb, 9007199254740991),
  '{"outcome":"revision-exhausted","record":null}'::jsonb, 'revision cap reports exhaustion'
);
select is(
  (select payload ->> 'defaultPresetId' from public.hiking_time_preset_records where user_id = '44444444-4444-4444-4444-444444444444'),
  'standard', 'exhausted revision leaves the payload unchanged'
);

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select results_eq(
  $$ select revision, payload ->> 'defaultPresetId' from public.hiking_time_preset_records $$,
  $$ values (2::bigint, 'fast'::text) $$,
  'RLS exposes only the authenticated owner preset record'
);
select throws_ok(
  $$ insert into public.hiking_time_preset_records (user_id, payload, revision) values ('33333333-3333-3333-3333-333333333333', '{}'::jsonb, 1) $$,
  '42501', null, 'authenticated direct preset inserts are denied'
);
select throws_ok(
  $$ update public.hiking_time_preset_records set revision = 1 $$,
  '42501', null, 'authenticated direct preset updates are denied'
);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select results_eq(
  $$ select user_id from public.hiking_time_preset_records $$,
  $$ values ('44444444-4444-4444-4444-444444444444'::uuid) $$,
  'RLS hides the first owner preset record from the second owner'
);
reset role;
set local role anon;
select throws_ok(
  $$ select count(*) from public.hiking_time_preset_records $$,
  '42501', null, 'anonymous preset reads are denied'
);
reset role;

select * from finish();
rollback;
