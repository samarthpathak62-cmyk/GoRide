-- Apply AFTER matching backend has service-role configuration and both new APKs are available.
alter table public.rides enable row level security;
revoke all on public.rides from anon,authenticated;
grant all on public.rides to service_role;
-- The old completion RPC accepted an arbitrary ride ID and had no actor check.
revoke all on function public.complete_ride_transaction(uuid) from public,anon,authenticated;
grant execute on function public.complete_ride_transaction(uuid) to service_role;

notify pgrst,'reload schema';
