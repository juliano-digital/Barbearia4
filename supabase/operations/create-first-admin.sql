-- Run once in the Supabase SQL Editor as a trusted project operator.
-- Replace the UUID with the id from Authentication > Users for the intended
-- administrator. This must not be exposed through the application.
do $$
declare
  v_user_id uuid := 'REPLACE_WITH_AUTH_USER_UUID';
  v_existing_admins integer;
  v_updated integer;
begin
  select count(*) into v_existing_admins
  from public.profiles
  where role = 'admin';

  if v_existing_admins > 0 then
    raise exception 'An administrator already exists; use the approved operator process';
  end if;

  update public.profiles
  set role = 'admin'
  where id = v_user_id and role = 'customer';

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'No matching customer profile was promoted; verify the Auth user UUID';
  end if;
end;
$$;
