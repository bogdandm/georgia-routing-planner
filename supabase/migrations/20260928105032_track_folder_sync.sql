create table public.track_folder_records (
  user_id uuid not null references auth.users (id) on delete cascade,
  folder_id text not null check (
    char_length(folder_id) between 1 and 200
    and octet_length(folder_id) <= 800
  ),
  revision bigint not null check (revision between 1 and 9007199254740991),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and payload ->> 'id' = folder_id
    and octet_length(payload::text) <= 4096
  ),
  updated_at timestamptz not null default now(),
  primary key (user_id, folder_id)
);

create index track_folder_records_user_revision_idx
on public.track_folder_records (user_id, revision);

create table private.user_folder_sync_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  next_revision bigint not null default 1
    check (next_revision between 1 and 9007199254740992),
  record_count integer not null default 0 check (record_count between 0 and 1000)
);

alter table public.track_folder_records enable row level security;

revoke all on table public.track_folder_records from public, anon, authenticated;
revoke all on table private.user_folder_sync_state from public, anon, authenticated, service_role;
grant select on table public.track_folder_records to authenticated;
grant select on table public.track_folder_records to service_role;

create policy "Users read their own track folder records"
on public.track_folder_records
for select
to authenticated
using ((select auth.uid()) = user_id);

create function public.upsert_track_folder(
  p_user_id uuid,
  p_folder_id text,
  p_payload jsonb,
  p_base_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.track_folder_records%rowtype;
  v_state private.user_folder_sync_state%rowtype;
  v_revision bigint;
begin
  if p_user_id is null
    or p_folder_id is null
    or char_length(p_folder_id) not between 1 and 200
    or octet_length(p_folder_id) > 800
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or p_payload ->> 'id' is distinct from p_folder_id
    or octet_length(p_payload::text) > 4096
    or p_base_revision is null
    or p_base_revision < 0
    or p_base_revision > 9007199254740991
  then
    raise exception 'invalid track folder upsert';
  end if;

  insert into private.user_folder_sync_state (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select user_folder_sync_state.* into strict v_state
  from private.user_folder_sync_state
  where user_folder_sync_state.user_id = p_user_id
  for update;

  if v_state.next_revision not between 1 and 9007199254740992
    or v_state.record_count not between 0 and 1000
  then
    raise exception 'invalid track folder synchronization state';
  end if;

  if v_state.next_revision = 9007199254740992 then
    return jsonb_build_object('outcome', 'revision-exhausted');
  end if;

  select track_folder_records.* into v_record
  from public.track_folder_records
  where track_folder_records.user_id = p_user_id
    and track_folder_records.folder_id = p_folder_id
  for update;

  if not found then
    if p_base_revision > 0 then
      return jsonb_build_object('outcome', 'missing');
    end if;

    if v_state.record_count = 1000 then
      return jsonb_build_object('outcome', 'limit');
    end if;

    update private.user_folder_sync_state
    set
      next_revision = next_revision + 1,
      record_count = record_count + 1
    where user_folder_sync_state.user_id = p_user_id
    returning next_revision - 1 into v_revision;

    insert into public.track_folder_records (user_id, folder_id, payload, revision)
    values (p_user_id, p_folder_id, p_payload, v_revision)
    returning * into v_record;

    return jsonb_build_object(
      'outcome', 'applied',
      'record', jsonb_build_object(
        'folder_id', v_record.folder_id,
        'revision', v_record.revision,
        'payload', v_record.payload
      )
    );
  end if;

  if v_record.revision <> p_base_revision then
    return jsonb_build_object(
      'outcome', 'conflict',
      'record', jsonb_build_object(
        'folder_id', v_record.folder_id,
        'revision', v_record.revision,
        'payload', v_record.payload
      )
    );
  end if;

  update private.user_folder_sync_state
  set next_revision = next_revision + 1
  where user_folder_sync_state.user_id = p_user_id
  returning next_revision - 1 into v_revision;

  update public.track_folder_records
  set payload = p_payload, revision = v_revision, updated_at = now()
  where track_folder_records.user_id = p_user_id
    and track_folder_records.folder_id = p_folder_id
  returning * into v_record;

  return jsonb_build_object(
    'outcome', 'applied',
    'record', jsonb_build_object(
      'folder_id', v_record.folder_id,
      'revision', v_record.revision,
      'payload', v_record.payload
    )
  );
end;
$$;

create function public.delete_track_folder(
  p_user_id uuid,
  p_folder_id text,
  p_base_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.track_folder_records%rowtype;
  v_state private.user_folder_sync_state%rowtype;
begin
  if p_user_id is null
    or p_folder_id is null
    or char_length(p_folder_id) not between 1 and 200
    or octet_length(p_folder_id) > 800
    or p_base_revision is null
    or p_base_revision < 0
    or p_base_revision > 9007199254740991
  then
    raise exception 'invalid track folder deletion';
  end if;

  insert into private.user_folder_sync_state (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select user_folder_sync_state.* into strict v_state
  from private.user_folder_sync_state
  where user_folder_sync_state.user_id = p_user_id
  for update;

  if v_state.next_revision not between 1 and 9007199254740992
    or v_state.record_count not between 0 and 1000
  then
    raise exception 'invalid track folder synchronization state';
  end if;

  select track_folder_records.* into v_record
  from public.track_folder_records
  where track_folder_records.user_id = p_user_id
    and track_folder_records.folder_id = p_folder_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'applied');
  end if;

  if v_record.revision <> p_base_revision then
    return jsonb_build_object(
      'outcome', 'conflict',
      'record', jsonb_build_object(
        'folder_id', v_record.folder_id,
        'revision', v_record.revision,
        'payload', v_record.payload
      )
    );
  end if;

  delete from public.track_folder_records
  where track_folder_records.user_id = p_user_id
    and track_folder_records.folder_id = p_folder_id;

  update private.user_folder_sync_state
  set record_count = record_count - 1
  where user_folder_sync_state.user_id = p_user_id;

  return jsonb_build_object('outcome', 'applied');
end;
$$;

create function private.provision_imports_track_folder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timestamp text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  insert into private.user_folder_sync_state (user_id, next_revision, record_count)
  values (new.id, 2, 1);

  insert into public.track_folder_records (user_id, folder_id, revision, payload)
  values (
    new.id,
    'imports',
    1,
    jsonb_build_object(
      'schemaVersion', 1,
      'id', 'imports',
      'name', 'Imports',
      'normalizedName', 'imports',
      'iconKey', 'folder',
      'position', 0,
      'createdAt', v_timestamp,
      'updatedAt', v_timestamp
    )
  );
  return new;
end;
$$;

create trigger provision_imports_track_folder_after_user_insert
after insert on auth.users
for each row execute function private.provision_imports_track_folder();

insert into private.user_folder_sync_state (user_id, next_revision, record_count)
select users.id, 2, 1
from auth.users as users;

insert into public.track_folder_records (user_id, folder_id, revision, payload)
select
  users.id,
  'imports',
  1,
  jsonb_build_object(
    'schemaVersion', 1,
    'id', 'imports',
    'name', 'Imports',
    'normalizedName', 'imports',
    'iconKey', 'folder',
    'position', 0,
    'createdAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
from auth.users as users;

do $$
declare
  v_user record;
  v_track public.track_records%rowtype;
  v_revision bigint;
begin
  for v_user in
    select distinct track_records.user_id
    from public.track_records
    where track_records.state = 'ready'
      and not (track_records.metadata ? 'folderId')
      and track_records.metadata ->> 'geometryKind' in ('track', 'route')
    order by track_records.user_id
  loop
    insert into public.user_track_usage (user_id)
    values (v_user.user_id)
    on conflict (user_id) do nothing;

    perform 1
    from public.user_track_usage
    where user_track_usage.user_id = v_user.user_id
    for update;

    for v_track in
      select track_records.*
      from public.track_records
      where track_records.user_id = v_user.user_id
        and track_records.state = 'ready'
        and not (track_records.metadata ? 'folderId')
        and track_records.metadata ->> 'geometryKind' in ('track', 'route')
      order by track_records.content_hash
      for update
    loop
      update public.user_track_usage
      set next_revision = next_revision + 1
      where user_track_usage.user_id = v_user.user_id
      returning next_revision - 1 into v_revision;

      update public.track_records
      set
        metadata = jsonb_set(
          metadata,
          '{folderId}',
          case
            when metadata ->> 'geometryKind' = 'track' then to_jsonb('imports'::text)
            else 'null'::jsonb
          end,
          true
        ),
        revision = v_revision,
        updated_at = now()
      where track_records.user_id = v_user.user_id
        and track_records.content_hash = v_track.content_hash;
    end loop;
  end loop;
end;
$$;

revoke execute on function private.provision_imports_track_folder()
from public, anon, authenticated, service_role;
revoke execute on function public.upsert_track_folder(uuid, text, jsonb, bigint)
from public, anon, authenticated;
revoke execute on function public.delete_track_folder(uuid, text, bigint)
from public, anon, authenticated;
grant execute on function public.upsert_track_folder(uuid, text, jsonb, bigint)
to service_role;
grant execute on function public.delete_track_folder(uuid, text, bigint)
to service_role;
