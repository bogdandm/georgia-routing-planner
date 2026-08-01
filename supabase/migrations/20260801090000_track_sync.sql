create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.user_track_usage (
  user_id uuid primary key references auth.users (id) on delete cascade,
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  reserved_bytes bigint not null default 0 check (reserved_bytes >= 0),
  next_revision bigint not null default 1 check (next_revision >= 1),
  check (used_bytes + reserved_bytes <= 8388608)
);

create table public.track_records (
  user_id uuid not null references auth.users (id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null check (jsonb_typeof(metadata) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  state text not null check (state in ('reserved', 'ready')),
  object_path text not null unique,
  compressed_bytes bigint not null check (compressed_bytes > 0 and compressed_bytes <= 8388608),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reservation_expires_at timestamptz,
  primary key (user_id, content_hash),
  check (
    object_path ~ (
      '^' || user_id::text || '/' || content_hash ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.grpt\.gz$'
    )
  ),
  check (
    (state = 'reserved' and revision = 0 and reservation_expires_at is not null)
    or (state = 'ready' and revision > 0 and reservation_expires_at is null)
  )
);

alter table public.user_track_usage enable row level security;
alter table public.track_records enable row level security;

revoke all on table public.user_track_usage from public, anon, authenticated;
revoke all on table public.track_records from public, anon, authenticated;
grant select on table public.user_track_usage to authenticated;
grant select on table public.track_records to authenticated;
grant select on table public.user_track_usage to service_role;
grant select on table public.track_records to service_role;

create policy "Users read their own track usage"
on public.user_track_usage
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users read their own track records"
on public.track_records
for select
to authenticated
using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'track-geometries',
  'track-geometries',
  false,
  8388608,
  array['application/gzip']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Users read their own track geometry"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'track-geometries'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create function private.reconcile_expired_track_reservations(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_record public.track_records%rowtype;
  v_revision bigint;
begin
  for v_record in
    select track_records.*
    from public.track_records
    where track_records.user_id = p_user_id
      and track_records.state = 'reserved'
      and track_records.reservation_expires_at <= clock_timestamp()
    order by track_records.content_hash
    for update
  loop
    if exists (
      select 1
      from storage.objects
      where objects.bucket_id = 'track-geometries'
        and objects.name = v_record.object_path
    ) then
      update public.user_track_usage
      set
        used_bytes = used_bytes + v_record.compressed_bytes,
        reserved_bytes = reserved_bytes - v_record.compressed_bytes,
        next_revision = next_revision + 1
      where user_track_usage.user_id = p_user_id
      returning next_revision - 1 into v_revision;

      update public.track_records
      set
        state = 'ready',
        revision = v_revision,
        reservation_expires_at = null,
        updated_at = now()
      where track_records.user_id = p_user_id
        and track_records.content_hash = v_record.content_hash;
    else
      delete from public.track_records
      where track_records.user_id = p_user_id
        and track_records.content_hash = v_record.content_hash;

      update public.user_track_usage
      set reserved_bytes = reserved_bytes - v_record.compressed_bytes
      where user_track_usage.user_id = p_user_id;
    end if;
  end loop;
end;
$$;

create function public.reserve_track_upload(
  p_user_id uuid,
  p_content_hash text,
  p_compressed_bytes bigint,
  p_metadata jsonb,
  p_base_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.track_records%rowtype;
  v_usage public.user_track_usage%rowtype;
  v_object_path text;
  v_revision bigint;
begin
  if p_user_id is null
    or p_content_hash is null
    or p_content_hash !~ '^[0-9a-f]{64}$'
    or p_compressed_bytes is null
    or p_compressed_bytes <= 0
    or p_compressed_bytes > 8388608
    or p_base_revision is null
    or p_base_revision < 0
    or p_metadata is null
    or jsonb_typeof(p_metadata) <> 'object'
  then
    raise exception 'invalid track upload reservation';
  end if;

  insert into public.user_track_usage (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select user_track_usage.* into strict v_usage
  from public.user_track_usage
  where user_track_usage.user_id = p_user_id
  for update;

  perform private.reconcile_expired_track_reservations(p_user_id);

  select user_track_usage.* into strict v_usage
  from public.user_track_usage
  where user_track_usage.user_id = p_user_id;

  select track_records.* into v_record
  from public.track_records
  where track_records.user_id = p_user_id
    and track_records.content_hash = p_content_hash
  for update;

  if found then
    if p_base_revision > 0 and v_record.revision <> p_base_revision then
      return jsonb_build_object('outcome', 'conflict', 'record', to_jsonb(v_record));
    end if;

    if v_record.state = 'ready' then
      if p_base_revision = 0 then
        return jsonb_build_object('outcome', 'existing', 'record', to_jsonb(v_record));
      end if;

      update public.user_track_usage
      set next_revision = next_revision + 1
      where user_track_usage.user_id = p_user_id
      returning next_revision - 1 into v_revision;

      update public.track_records
      set metadata = p_metadata, revision = v_revision, updated_at = now()
      where track_records.user_id = p_user_id
        and track_records.content_hash = p_content_hash
      returning * into v_record;

      return jsonb_build_object('outcome', 'applied', 'record', to_jsonb(v_record));
    end if;

    if v_record.compressed_bytes <> p_compressed_bytes then
      return jsonb_build_object('outcome', 'conflict', 'record', to_jsonb(v_record));
    end if;

    return jsonb_build_object(
      'outcome', 'upload',
      'record', to_jsonb(v_record),
      'objectPath', v_record.object_path
    );
  end if;

  if p_base_revision <> 0 then
    return jsonb_build_object('outcome', 'missing');
  end if;

  if v_usage.used_bytes + v_usage.reserved_bytes + p_compressed_bytes > 8388608 then
    raise exception 'track geometry quota exceeded' using errcode = 'P0001';
  end if;

  v_object_path := p_user_id::text || '/' || p_content_hash || '/' || gen_random_uuid()::text || '.grpt.gz';

  insert into public.track_records (
    user_id,
    content_hash,
    metadata,
    revision,
    state,
    object_path,
    compressed_bytes,
    reservation_expires_at
  ) values (
    p_user_id,
    p_content_hash,
    p_metadata,
    0,
    'reserved',
    v_object_path,
    p_compressed_bytes,
    now() + interval '10 minutes'
  )
  returning * into v_record;

  update public.user_track_usage
  set reserved_bytes = reserved_bytes + p_compressed_bytes
  where user_track_usage.user_id = p_user_id;

  return jsonb_build_object(
    'outcome', 'upload',
    'record', to_jsonb(v_record),
    'objectPath', v_object_path
  );
end;
$$;

create function public.finalize_track_upload(p_user_id uuid, p_content_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.track_records%rowtype;
  v_revision bigint;
begin
  if p_user_id is null or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid track upload finalization';
  end if;

  insert into public.user_track_usage (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  perform 1
  from public.user_track_usage
  where user_track_usage.user_id = p_user_id
  for update;

  perform private.reconcile_expired_track_reservations(p_user_id);

  select track_records.* into v_record
  from public.track_records
  where track_records.user_id = p_user_id
    and track_records.content_hash = p_content_hash
  for update;

  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;

  if v_record.state = 'ready' then
    return jsonb_build_object('outcome', 'existing', 'record', to_jsonb(v_record));
  end if;

  if not exists (
    select 1
    from storage.objects
    where objects.bucket_id = 'track-geometries'
      and objects.name = v_record.object_path
  ) then
    raise exception 'reserved track object is missing';
  end if;

  update public.user_track_usage
  set
    used_bytes = used_bytes + v_record.compressed_bytes,
    reserved_bytes = reserved_bytes - v_record.compressed_bytes,
    next_revision = next_revision + 1
  where user_track_usage.user_id = p_user_id
  returning next_revision - 1 into v_revision;

  update public.track_records
  set
    state = 'ready',
    revision = v_revision,
    reservation_expires_at = null,
    updated_at = now()
  where track_records.user_id = p_user_id
    and track_records.content_hash = p_content_hash
  returning * into v_record;

  return jsonb_build_object('outcome', 'applied', 'record', to_jsonb(v_record));
end;
$$;

create function public.release_track_upload(p_user_id uuid, p_content_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.track_records%rowtype;
begin
  if p_user_id is null or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid track upload release';
  end if;

  insert into public.user_track_usage (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  perform 1
  from public.user_track_usage
  where user_track_usage.user_id = p_user_id
  for update;

  perform private.reconcile_expired_track_reservations(p_user_id);

  delete from public.track_records
  where track_records.user_id = p_user_id
    and track_records.content_hash = p_content_hash
    and track_records.state = 'reserved'
  returning * into v_record;

  if found then
    update public.user_track_usage
    set reserved_bytes = reserved_bytes - v_record.compressed_bytes
    where user_track_usage.user_id = p_user_id;
  end if;
end;
$$;

create function public.apply_track_metadata(
  p_user_id uuid,
  p_content_hash text,
  p_base_revision bigint,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.track_records%rowtype;
  v_revision bigint;
begin
  if p_user_id is null
    or p_content_hash is null
    or p_content_hash !~ '^[0-9a-f]{64}$'
    or p_base_revision is null
    or p_base_revision < 0
    or p_metadata is null
    or jsonb_typeof(p_metadata) <> 'object'
  then
    raise exception 'invalid track metadata update';
  end if;

  insert into public.user_track_usage (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  perform 1
  from public.user_track_usage
  where user_track_usage.user_id = p_user_id
  for update;

  perform private.reconcile_expired_track_reservations(p_user_id);

  select track_records.* into v_record
  from public.track_records
  where track_records.user_id = p_user_id
    and track_records.content_hash = p_content_hash
  for update;

  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;

  if v_record.state <> 'ready' or v_record.revision <> p_base_revision then
    return jsonb_build_object('outcome', 'conflict', 'record', to_jsonb(v_record));
  end if;

  update public.user_track_usage
  set next_revision = next_revision + 1
  where user_track_usage.user_id = p_user_id
  returning next_revision - 1 into v_revision;

  update public.track_records
  set metadata = p_metadata, revision = v_revision, updated_at = now()
  where track_records.user_id = p_user_id
    and track_records.content_hash = p_content_hash
  returning * into v_record;

  return jsonb_build_object('outcome', 'applied', 'record', to_jsonb(v_record));
end;
$$;

create function public.delete_track(
  p_user_id uuid,
  p_content_hash text,
  p_base_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.track_records%rowtype;
begin
  if p_user_id is null
    or p_content_hash is null
    or p_content_hash !~ '^[0-9a-f]{64}$'
    or p_base_revision is null
    or p_base_revision < 0
  then
    raise exception 'invalid track deletion';
  end if;

  insert into public.user_track_usage (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  perform 1
  from public.user_track_usage
  where user_track_usage.user_id = p_user_id
  for update;

  perform private.reconcile_expired_track_reservations(p_user_id);

  select track_records.* into v_record
  from public.track_records
  where track_records.user_id = p_user_id
    and track_records.content_hash = p_content_hash
  for update;

  if not found then
    return jsonb_build_object('outcome', 'applied');
  end if;

  if v_record.revision <> p_base_revision then
    return jsonb_build_object('outcome', 'conflict', 'record', to_jsonb(v_record));
  end if;

  delete from public.track_records
  where track_records.user_id = p_user_id
    and track_records.content_hash = p_content_hash;

  if v_record.state = 'ready' then
    update public.user_track_usage
    set used_bytes = used_bytes - v_record.compressed_bytes
    where user_track_usage.user_id = p_user_id;
  else
    update public.user_track_usage
    set reserved_bytes = reserved_bytes - v_record.compressed_bytes
    where user_track_usage.user_id = p_user_id;
  end if;

  return jsonb_build_object('outcome', 'applied', 'objectPath', v_record.object_path);
end;
$$;


revoke execute on function private.reconcile_expired_track_reservations(uuid)
from public, anon, authenticated, service_role;

revoke execute on function public.reserve_track_upload(uuid, text, bigint, jsonb, bigint)
from public, anon, authenticated;
revoke execute on function public.finalize_track_upload(uuid, text)
from public, anon, authenticated;
revoke execute on function public.release_track_upload(uuid, text)
from public, anon, authenticated;
revoke execute on function public.apply_track_metadata(uuid, text, bigint, jsonb)
from public, anon, authenticated;
revoke execute on function public.delete_track(uuid, text, bigint)
from public, anon, authenticated;

grant execute on function public.reserve_track_upload(uuid, text, bigint, jsonb, bigint)
to service_role;
grant execute on function public.finalize_track_upload(uuid, text)
to service_role;
grant execute on function public.release_track_upload(uuid, text)
to service_role;
grant execute on function public.apply_track_metadata(uuid, text, bigint, jsonb)
to service_role;
grant execute on function public.delete_track(uuid, text, bigint)
to service_role;
