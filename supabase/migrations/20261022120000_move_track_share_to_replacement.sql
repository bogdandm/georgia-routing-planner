-- A point edit uploads the edited track as a new record whose metadata names the
-- records it replaces in `replacesContentHashes`, newest first; the browser deletes them
-- afterwards. A public share of a replaced record moves to the replacement once it is
-- ready, keeping its token, so the published link keeps working and shows the edit.
create function private.move_track_share_to_replacement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_predecessor text;
begin
  if new.state <> 'ready'
    or jsonb_typeof(new.metadata -> 'replacesContentHashes') is distinct from 'array'
    or exists (
      select 1
      from public.track_shares
      where track_shares.user_id = new.user_id
        and track_shares.content_hash = new.content_hash
    )
  then
    return null;
  end if;

  select predecessors.content_hash into v_predecessor
  from jsonb_array_elements_text(new.metadata -> 'replacesContentHashes')
    with ordinality as predecessors(content_hash, position)
  join public.track_shares
    on track_shares.user_id = new.user_id
   and track_shares.content_hash = predecessors.content_hash
  order by predecessors.position
  limit 1;

  if v_predecessor is not null then
    update public.track_shares
    set content_hash = new.content_hash
    where track_shares.user_id = new.user_id
      and track_shares.content_hash = v_predecessor;
  end if;
  return null;
end;
$$;

revoke execute on function private.move_track_share_to_replacement()
from public, anon, authenticated;

create trigger move_track_share_to_replacement
after insert or update of state, metadata on public.track_records
for each row
execute function private.move_track_share_to_replacement();
