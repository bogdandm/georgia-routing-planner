create or replace function public.keep_project_alive()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select true;
$$;

revoke execute on function public.keep_project_alive()
from public, anon, authenticated, service_role;

grant execute on function public.keep_project_alive()
to anon;
