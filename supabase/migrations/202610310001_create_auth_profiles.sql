-- Every auth account needs a profile before driver verification can reference it.
create or replace function public.goride_create_auth_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.goride_create_auth_profile() from public;
drop trigger if exists goride_create_auth_profile on auth.users;
create trigger goride_create_auth_profile
  after insert on auth.users
  for each row execute function public.goride_create_auth_profile();
-- Repair existing accounts too, without changing balances or profile details.
insert into public.profiles (id, full_name)
select id, coalesce(raw_user_meta_data ->> 'full_name', '') from auth.users
on conflict (id) do nothing;
