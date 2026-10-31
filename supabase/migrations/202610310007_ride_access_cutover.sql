-- Apply AFTER matching backend has service-role configuration and both new APKs are available.
alter table public.rides enable row level security;
revoke all on public.rides from public,anon,authenticated;
grant all on public.rides to service_role;
-- The old completion RPC accepted an arbitrary ride ID and had no actor check.
revoke all on function public.complete_ride_transaction(uuid) from public,anon,authenticated;
grant execute on function public.complete_ride_transaction(uuid) to service_role;

notify pgrst,'reload schema';

-- Chat reads/writes now go through authenticated HTTP/socket participant checks.
alter table public.messages enable row level security;
revoke all on public.messages from public,anon,authenticated;
grant all on public.messages to service_role;
revoke all on function public.get_user_conversations(uuid) from public,anon,authenticated;
grant execute on function public.get_user_conversations(uuid) to service_role;
revoke all on function public.get_nearby_drivers(float8,float8,float8) from public,anon,authenticated;
grant execute on function public.get_nearby_drivers(float8,float8,float8) to service_role;
alter function public.complete_ride_transaction(uuid) set search_path='';
notify pgrst,'reload schema';
