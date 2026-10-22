-- A point edit uploads the edited track as a new record whose metadata names the
-- records it replaces in `replacesContentHashes`, newest first; the browser deletes them
-- only after the replacement is ready. Deleting a shared replaced record moves its share
-- to the newest ready replacement instead of cascading it, keeping the token, so the
-- published link keeps working and shows the edit. Moving at deletion, which locks the
-- replaced row as `enable_track_share` does, also covers a share enabled while the
-- replacement was being uploaded; locking each candidate replacement before checking
-- its share serializes with a share being enabled on the replacement itself.
create function private.move_track_share_to_replacement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replacement text;
begin
  if not exists (
    select 1
    from public.track_shares
    where track_shares.user_id = old.user_id
      and track_shares.content_hash = old.content_hash
  ) then
    return old;
  end if;

  for v_replacement in
    select replacements.content_hash
    from public.track_records as replacements
    where replacements.user_id = old.user_id
      and replacements.content_hash <> old.content_hash
      and replacements.state = 'ready'
      and jsonb_typeof(replacements.metadata -> 'replacesContentHashes') = 'array'
      and replacements.metadata -> 'replacesContentHashes' ? old.content_hash
    order by replacements.revision desc
    for update
  loop
    if not exists (
      select 1
      from public.track_shares
      where track_shares.user_id = old.user_id
        and track_shares.content_hash = v_replacement
    ) then
      update public.track_shares
      set content_hash = v_replacement
      where track_shares.user_id = old.user_id
        and track_shares.content_hash = old.content_hash;
      return old;
    end if;
  end loop;
  return old;
end;
$$;

revoke execute on function private.move_track_share_to_replacement()
from public, anon, authenticated;

create trigger move_track_share_to_replacement
before delete on public.track_records
for each row
execute function private.move_track_share_to_replacement();
