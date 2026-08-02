drop function public.release_track_upload(uuid, text);

create function public.release_track_upload(
  p_user_id uuid,
  p_content_hash text,
  p_object_path text
)
returns void
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
    or p_object_path is null
    or p_object_path = ''
  then
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
    and track_records.object_path = p_object_path
    and track_records.state = 'reserved'
  returning * into v_record;

  if found then
    update public.user_track_usage
    set reserved_bytes = reserved_bytes - v_record.compressed_bytes
    where user_track_usage.user_id = p_user_id;
  end if;
end;
$$;

revoke execute on function public.release_track_upload(uuid, text, text)
from public, anon, authenticated;

grant execute on function public.release_track_upload(uuid, text, text)
to service_role;
