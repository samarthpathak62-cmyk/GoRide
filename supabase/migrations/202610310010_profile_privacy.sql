-- Coordinate after scoped profile access + service-role notifications deploy.
alter table public.profiles enable row level security;
revoke all on public.profiles from public,anon,authenticated;
grant select on public.profiles to authenticated;
grant update(full_name,profile_pic,fcm_token) on public.profiles to authenticated;
grant all on public.profiles to service_role;
create policy profile_read_self on public.profiles for select to authenticated using(id=auth.uid());
create policy profile_update_self on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
alter table public.transactions enable row level security;
revoke all on public.transactions from public,anon,authenticated;
grant select on public.transactions to authenticated;
grant all on public.transactions to service_role;
create policy transaction_read_self on public.transactions for select to authenticated using(user_id=auth.uid());
notify pgrst,'reload schema';
