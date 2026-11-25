create table public.hiking_time_preset_records (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 262144
  ),
  revision bigint not null check (revision between 1 and 9007199254740991),
  updated_at timestamptz not null default now()
);

alter table public.hiking_time_preset_records enable row level security;

revoke all on table public.hiking_time_preset_records from public, anon, authenticated;
grant select on table public.hiking_time_preset_records to authenticated;
grant select on table public.hiking_time_preset_records to service_role;

create policy "Users read their own hiking time presets"
on public.hiking_time_preset_records
for select
to authenticated
using ((select auth.uid()) = user_id);

create function public.upsert_hiking_time_presets(
  p_user_id uuid,
  p_payload jsonb,
  p_base_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.hiking_time_preset_records%rowtype;
begin
  if p_user_id is null
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 262144
    or p_base_revision is null
    or p_base_revision < 0
    or p_base_revision > 9007199254740991
  then
    raise exception 'invalid hiking time presets upsert';
  end if;

  if p_base_revision = 0 then
    insert into public.hiking_time_preset_records (user_id, payload, revision)
    values (p_user_id, p_payload, 1)
    on conflict (user_id) do nothing
    returning * into v_record;

    if found then
      return jsonb_build_object(
        'outcome', 'applied',
        'record', jsonb_build_object('revision', v_record.revision, 'payload', v_record.payload)
      );
    end if;

    select hiking_time_preset_records.* into strict v_record
    from public.hiking_time_preset_records
    where hiking_time_preset_records.user_id = p_user_id;

    return jsonb_build_object(
      'outcome', 'conflict',
      'record', jsonb_build_object('revision', v_record.revision, 'payload', v_record.payload)
    );
  end if;

  select hiking_time_preset_records.* into v_record
  from public.hiking_time_preset_records
  where hiking_time_preset_records.user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'missing', 'record', null);
  end if;

  if v_record.revision <> p_base_revision then
    return jsonb_build_object(
      'outcome', 'conflict',
      'record', jsonb_build_object('revision', v_record.revision, 'payload', v_record.payload)
    );
  end if;

  if v_record.revision = 9007199254740991 then
    return jsonb_build_object('outcome', 'revision-exhausted', 'record', null);
  end if;

  update public.hiking_time_preset_records
  set
    payload = p_payload,
    revision = revision + 1,
    updated_at = now()
  where hiking_time_preset_records.user_id = p_user_id
  returning * into v_record;

  return jsonb_build_object(
    'outcome', 'applied',
    'record', jsonb_build_object('revision', v_record.revision, 'payload', v_record.payload)
  );
end;
$$;

revoke execute on function public.upsert_hiking_time_presets(uuid, jsonb, bigint)
from public, anon, authenticated;
grant execute on function public.upsert_hiking_time_presets(uuid, jsonb, bigint)
to service_role;
