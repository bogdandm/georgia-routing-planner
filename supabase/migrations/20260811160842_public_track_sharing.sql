create table public.track_shares (
  share_token_hash text primary key check (share_token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  token_nonce text not null check (token_nonce ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default now(),
  unique (user_id, content_hash),
  foreign key (user_id, content_hash)
    references public.track_records (user_id, content_hash)
    on delete cascade
);

alter table public.track_shares enable row level security;
revoke all on table public.track_shares from public, anon, authenticated;

create function public.enable_track_share(
  p_user_id uuid,
  p_content_hash text,
  p_share_token_hash text,
  p_token_nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.track_records%rowtype;
  v_share public.track_shares%rowtype;
begin
  if p_user_id is null
    or p_content_hash is null
    or p_content_hash !~ '^[0-9a-f]{64}$'
    or p_share_token_hash is null
    or p_share_token_hash !~ '^[0-9a-f]{64}$'
    or p_token_nonce is null
    or p_token_nonce !~ '^[A-Za-z0-9_-]{43}$'
  then
    raise exception 'invalid track share enable';
  end if;

  select track_records.* into v_record
  from public.track_records
  where track_records.user_id = p_user_id
    and track_records.content_hash = p_content_hash
  for update;

  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if v_record.state <> 'ready' then
    return jsonb_build_object('outcome', 'not_ready');
  end if;

  select track_shares.* into v_share
  from public.track_shares
  where track_shares.user_id = p_user_id
    and track_shares.content_hash = p_content_hash;

  if found then
    return jsonb_build_object(
      'outcome', 'enabled',
      'share_token_hash', v_share.share_token_hash,
      'token_nonce', v_share.token_nonce
    );
  end if;

  insert into public.track_shares (
    share_token_hash,
    user_id,
    content_hash,
    token_nonce
  ) values (
    p_share_token_hash,
    p_user_id,
    p_content_hash,
    p_token_nonce
  )
  returning * into v_share;

  return jsonb_build_object(
    'outcome', 'enabled',
    'share_token_hash', v_share.share_token_hash,
    'token_nonce', v_share.token_nonce
  );
end;
$$;

create function public.read_track_share(
  p_user_id uuid,
  p_content_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.track_records%rowtype;
  v_share public.track_shares%rowtype;
begin
  if p_user_id is null
    or p_content_hash is null
    or p_content_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid track share read';
  end if;

  select track_records.* into v_record
  from public.track_records
  where track_records.user_id = p_user_id
    and track_records.content_hash = p_content_hash;

  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if v_record.state <> 'ready' then
    return jsonb_build_object('outcome', 'not_ready');
  end if;

  select track_shares.* into v_share
  from public.track_shares
  where track_shares.user_id = p_user_id
    and track_shares.content_hash = p_content_hash;

  if not found then
    return jsonb_build_object('outcome', 'disabled');
  end if;
  return jsonb_build_object(
    'outcome', 'enabled',
    'share_token_hash', v_share.share_token_hash,
    'token_nonce', v_share.token_nonce
  );
end;
$$;

create function public.disable_track_share(
  p_user_id uuid,
  p_content_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null
    or p_content_hash is null
    or p_content_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid track share disable';
  end if;

  perform 1
  from public.track_records
  where track_records.user_id = p_user_id
    and track_records.content_hash = p_content_hash
  for update;

  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;

  delete from public.track_shares
  where track_shares.user_id = p_user_id
    and track_shares.content_hash = p_content_hash;
  return jsonb_build_object('outcome', 'disabled');
end;
$$;

create function public.resolve_track_share(p_share_token_hash text)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'content_hash', track_records.content_hash,
    'compressed_bytes', track_records.compressed_bytes,
    'object_path', track_records.object_path,
    'metadata', jsonb_build_object(
      'name', track_records.metadata ->> 'name',
      'sourceFormat', track_records.metadata ->> 'sourceFormat',
      'geometryKind', track_records.metadata ->> 'geometryKind',
      'updatedAt', track_records.metadata ->> 'updatedAt'
    )
  )
  from public.track_shares
  join public.track_records
    on track_records.user_id = track_shares.user_id
   and track_records.content_hash = track_shares.content_hash
  where track_shares.share_token_hash = p_share_token_hash
    and track_records.state = 'ready'
    and p_share_token_hash ~ '^[0-9a-f]{64}$'
$$;

revoke execute on function public.enable_track_share(uuid, text, text, text)
from public, anon, authenticated;
revoke execute on function public.read_track_share(uuid, text)
from public, anon, authenticated;
revoke execute on function public.disable_track_share(uuid, text)
from public, anon, authenticated;
revoke execute on function public.resolve_track_share(text)
from public, anon, authenticated;

grant execute on function public.enable_track_share(uuid, text, text, text)
to service_role;
grant execute on function public.read_track_share(uuid, text)
to service_role;
grant execute on function public.disable_track_share(uuid, text)
to service_role;
grant execute on function public.resolve_track_share(text)
to service_role;