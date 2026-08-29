begin;

select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'authenticated', 'authenticated', 'share-owner@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'authenticated', 'authenticated', 'share-other@example.test', 'not-a-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.user_track_usage (user_id, used_bytes, reserved_bytes)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 17, 0);

insert into public.track_records (
  user_id, content_hash, metadata, revision, state, object_path, compressed_bytes
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  repeat('a', 64),
  '{"name":"Shared ridge","sourceFormat":"gpx","geometryKind":"track","updatedAt":"2026-08-11T00:00:00.000Z","sourceFilename":"private.gpx"}'::jsonb,
  1,
  'ready',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' || repeat('a', 64) || '/11111111-1111-4111-8111-111111111111.grpt.gz',
  17
), (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  repeat('b', 64),
  '{"name":"Reserved","sourceFormat":"gpx","geometryKind":"track","updatedAt":"2026-08-11T00:00:00.000Z"}'::jsonb,
  0,
  'reserved',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' || repeat('b', 64) || '/22222222-2222-4222-8222-222222222222.grpt.gz',
  1,
  now() + interval '10 minutes'
);

insert into public.track_records (
  user_id, content_hash, metadata, revision, state, object_path, compressed_bytes
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  repeat('c', 64),
  '{"lineageHash":"not-public-metadata","geometryVersion":2}'::jsonb,
  1,
  'ready',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' || repeat('c', 64) || '/33333333-3333-4333-8333-333333333333.grpt.gz',
  17
);

select has_table('public', 'track_shares', 'track shares table exists');
select col_is_pk('public', 'track_shares', 'share_token_hash', 'token digest is the primary key');
select col_is_unique('public', 'track_shares', array['user_id', 'content_hash'], 'owner track has one share state');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.track_shares'::regclass),
  'track shares enable row-level security'
);
select table_privs_are('public', 'track_shares', 'anon', array[]::text[], 'anon has no direct table access');
select table_privs_are('public', 'track_shares', 'authenticated', array[]::text[], 'authenticated has no direct table access');
select function_privs_are('public', 'enable_track_share', array['uuid', 'text', 'text', 'text'], 'anon', array[]::text[], 'anon cannot enable shares');
select function_privs_are('public', 'resolve_track_share', array['text'], 'authenticated', array[]::text[], 'authenticated cannot resolve shares directly');

select is(
  public.enable_track_share('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('a', 64), repeat('c', 64), 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') ->> 'outcome',
  'enabled', 'ready owner track enables a share'
);
select is(
  public.enable_track_share('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('a', 64), repeat('d', 64), 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB') ->> 'share_token_hash',
  repeat('c', 64), 'repeat enables keep the original digest'
);
select is(
  public.read_track_share('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('a', 64)) ->> 'token_nonce',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'status preserves the original nonce'
);
select is(
  public.enable_track_share('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('b', 64), repeat('e', 64), 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC') ->> 'outcome',
  'not_ready', 'reserved tracks cannot be shared'
);
select is(
  public.enable_track_share('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('f', 64), repeat('e', 64), 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC') ->> 'outcome',
  'missing', 'missing tracks cannot be shared'
);
select is(
  public.enable_track_share('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('c', 64), repeat('f', 64), 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD') ->> 'outcome',
  'not_shareable', 'ready tracks require public metadata before sharing'
);

select is(
  public.resolve_track_share(repeat('c', 64)) -> 'metadata',
  '{"name":"Shared ridge","sourceFormat":"gpx","geometryKind":"track","updatedAt":"2026-08-11T00:00:00.000Z"}'::jsonb,
  'resolve exposes only the public metadata projection'
);
select is(
  (select used_bytes from public.user_track_usage where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  17::bigint, 'share state does not affect quota usage'
);
update public.track_records
set metadata = '{"lineageHash":"not-public-metadata","geometryVersion":2}'::jsonb
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and content_hash = repeat('a', 64);
select is(
  public.read_track_share('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('a', 64)) ->> 'outcome',
  'not_shareable', 'metadata changes disable public sharing until metadata is restored'
);
select is(
  public.resolve_track_share(repeat('c', 64)), null::jsonb,
  'shares with invalidated metadata resolve as missing'
);

select is(
  public.disable_track_share('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('a', 64)) ->> 'outcome',
  'disabled', 'owner disables a share'
);
select is(
  public.resolve_track_share(repeat('c', 64)), null::jsonb, 'disabled shares resolve as missing'
);
select is(
  public.disable_track_share('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('a', 64)) ->> 'outcome',
  'disabled', 'share disable is idempotent'
);

select public.enable_track_share('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('a', 64), repeat('d', 64), 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
delete from public.track_records where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and content_hash = repeat('a', 64);
select is((select count(*) from public.track_shares), 0::bigint, 'track deletion cascades to the share row');

select * from finish();
rollback;
