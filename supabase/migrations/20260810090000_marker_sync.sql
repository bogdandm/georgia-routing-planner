create table public.marker_records (
  user_id uuid not null references auth.users (id) on delete cascade,
  marker_id text not null check (
    char_length(marker_id) between 1 and 200
    and octet_length(marker_id) <= 800
  ),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and payload ->> 'id' = marker_id
    and octet_length(payload::text) <= 8192
  ),
  revision bigint not null check (revision between 1 and 9007199254740991),
  updated_at timestamptz not null default now(),
  primary key (user_id, marker_id)
);

create table private.user_marker_sync_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  next_revision bigint not null default 1
    check (next_revision between 1 and 9007199254740992),
  record_count integer not null default 0 check (record_count between 0 and 10000)
);

alter table public.marker_records enable row level security;

revoke all on table public.marker_records from public, anon, authenticated;
revoke all on table private.user_marker_sync_state from public, anon, authenticated, service_role;
grant select on table public.marker_records to authenticated;
grant select on table public.marker_records to service_role;

create policy "Users read their own marker records"
on public.marker_records
for select
to authenticated
using ((select auth.uid()) = user_id);

create function public.upsert_marker(
  p_user_id uuid,
  p_marker_id text,
  p_payload jsonb,
  p_base_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.marker_records%rowtype;
  v_state private.user_marker_sync_state%rowtype;
  v_revision bigint;
begin
  if p_user_id is null
    or p_marker_id is null
    or char_length(p_marker_id) not between 1 and 200
    or octet_length(p_marker_id) > 800
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or p_payload ->> 'id' is distinct from p_marker_id
    or octet_length(p_payload::text) > 8192
    or p_base_revision is null
    or p_base_revision < 0
    or p_base_revision > 9007199254740991
  then
    raise exception 'invalid marker upsert';
  end if;

  insert into private.user_marker_sync_state (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select user_marker_sync_state.* into strict v_state
  from private.user_marker_sync_state
  where user_marker_sync_state.user_id = p_user_id
  for update;

  if v_state.next_revision not between 1 and 9007199254740992
    or v_state.record_count not between 0 and 10000
  then
    raise exception 'invalid marker synchronization state';
  end if;

  if v_state.next_revision = 9007199254740992 then
    return jsonb_build_object('outcome', 'revision-exhausted');
  end if;

  select marker_records.* into v_record
  from public.marker_records
  where marker_records.user_id = p_user_id
    and marker_records.marker_id = p_marker_id
  for update;

  if not found then
    if p_base_revision > 0 then
      return jsonb_build_object('outcome', 'missing');
    end if;

    if v_state.record_count = 10000 then
      return jsonb_build_object('outcome', 'limit');
    end if;

    update private.user_marker_sync_state
    set
      next_revision = next_revision + 1,
      record_count = record_count + 1
    where user_marker_sync_state.user_id = p_user_id
    returning next_revision - 1 into v_revision;

    insert into public.marker_records (user_id, marker_id, payload, revision)
    values (p_user_id, p_marker_id, p_payload, v_revision)
    returning * into v_record;

    return jsonb_build_object(
      'outcome', 'applied',
      'record', jsonb_build_object(
        'marker_id', v_record.marker_id,
        'revision', v_record.revision,
        'payload', v_record.payload
      )
    );
  end if;

  if v_record.revision <> p_base_revision then
    return jsonb_build_object(
      'outcome', 'conflict',
      'record', jsonb_build_object(
        'marker_id', v_record.marker_id,
        'revision', v_record.revision,
        'payload', v_record.payload
      )
    );
  end if;

  update private.user_marker_sync_state
  set next_revision = next_revision + 1
  where user_marker_sync_state.user_id = p_user_id
  returning next_revision - 1 into v_revision;

  update public.marker_records
  set payload = p_payload, revision = v_revision, updated_at = now()
  where marker_records.user_id = p_user_id
    and marker_records.marker_id = p_marker_id
  returning * into v_record;

  return jsonb_build_object(
    'outcome', 'applied',
    'record', jsonb_build_object(
      'marker_id', v_record.marker_id,
      'revision', v_record.revision,
      'payload', v_record.payload
    )
  );
end;
$$;

create function public.delete_marker(
  p_user_id uuid,
  p_marker_id text,
  p_base_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.marker_records%rowtype;
  v_state private.user_marker_sync_state%rowtype;
begin
  if p_user_id is null
    or p_marker_id is null
    or char_length(p_marker_id) not between 1 and 200
    or octet_length(p_marker_id) > 800
    or p_base_revision is null
    or p_base_revision < 0
    or p_base_revision > 9007199254740991
  then
    raise exception 'invalid marker deletion';
  end if;

  insert into private.user_marker_sync_state (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select user_marker_sync_state.* into strict v_state
  from private.user_marker_sync_state
  where user_marker_sync_state.user_id = p_user_id
  for update;

  if v_state.next_revision not between 1 and 9007199254740992
    or v_state.record_count not between 0 and 10000
  then
    raise exception 'invalid marker synchronization state';
  end if;

  select marker_records.* into v_record
  from public.marker_records
  where marker_records.user_id = p_user_id
    and marker_records.marker_id = p_marker_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'applied');
  end if;

  if v_record.revision <> p_base_revision then
    return jsonb_build_object(
      'outcome', 'conflict',
      'record', jsonb_build_object(
        'marker_id', v_record.marker_id,
        'revision', v_record.revision,
        'payload', v_record.payload
      )
    );
  end if;

  delete from public.marker_records
  where marker_records.user_id = p_user_id
    and marker_records.marker_id = p_marker_id;

  update private.user_marker_sync_state
  set record_count = record_count - 1
  where user_marker_sync_state.user_id = p_user_id;

  return jsonb_build_object('outcome', 'applied');
end;
$$;

revoke execute on function public.upsert_marker(uuid, text, jsonb, bigint)
from public, anon, authenticated;
revoke execute on function public.delete_marker(uuid, text, bigint)
from public, anon, authenticated;
grant execute on function public.upsert_marker(uuid, text, jsonb, bigint)
to service_role;
grant execute on function public.delete_marker(uuid, text, bigint)
to service_role;
