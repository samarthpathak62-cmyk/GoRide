-- Additive preparation; deploy matching backend/APKs before migration 007.
create table public.ride_events (
 id uuid primary key default gen_random_uuid(), ride_id uuid not null references public.rides(id),
 actor_id uuid not null, action text not null, from_status text, to_status text not null,
 created_at timestamptz not null default now()
);
alter table public.ride_events enable row level security;
revoke all on public.ride_events from public,anon,authenticated;
grant select,insert on public.ride_events to service_role;
create index if not exists ride_events_ride_created on public.ride_events(ride_id,created_at);

create or replace function public.request_ride_secure(p_actor uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rides; balance numeric; price numeric;
begin
 if p_actor is null then raise exception 'Actor required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ride-user:'||p_actor::text,0));
 if exists(select 1 from public.rides where (user_id=p_actor or driver_id in (select id from public.drivers where user_id=p_actor)) and status in ('pending','driver_assigned','accepted','driver_arrived','started')) then
  raise exception 'You already have an active ride' using errcode='P0001';
 end if;
 price:=(p_payload->>'fare')::numeric;
 if price is null or price<=0 then raise exception 'Invalid fare'; end if;
 select wallet_balance into balance from public.profiles where id=p_actor for update;
 if balance is null or balance<price then raise exception 'Insufficient wallet balance'; end if;
 insert into public.rides(user_id,pickup_location,drop_location,category,fare,pickup_latitude,pickup_longitude,drop_latitude,drop_longitude,pickup_coords,drop_coords,status)
 values(p_actor,p_payload->>'pickupLocation',p_payload->>'dropLocation',p_payload->>'category',price,
  (p_payload->>'pickupLatitude')::float8,(p_payload->>'pickupLongitude')::float8,
  (p_payload->>'dropLatitude')::float8,(p_payload->>'dropLongitude')::float8,
  (p_payload->>'pickupCoords')::extensions.geography,(p_payload->>'dropCoords')::extensions.geography,'pending') returning * into r;
 insert into public.ride_events(ride_id,actor_id,action,to_status) values(r.id,p_actor,'request','pending');
 return to_jsonb(r);
end; $$;

create or replace function public.ride_action_secure(p_ride uuid,p_actor uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rides; captain public.drivers; old_status text; result jsonb; wallet numeric;
begin
 if p_actor is null then raise exception 'Actor required' using errcode='42501'; end if;
 -- Serialise concurrent acceptances by one captain, then lock the ride itself.
 perform pg_advisory_xact_lock(hashtextextended('ride-user:'||p_actor::text,0));
 select * into r from public.rides where id=p_ride for update;
 if not found then raise exception 'Ride unavailable' using errcode='P0002'; end if;
 old_status:=r.status;
 select * into captain from public.drivers where user_id=p_actor;
 if p_action='accept' then
  if captain.id is null or captain.user_id=r.user_id or captain.status is distinct from 'approved' or captain.is_online is distinct from true or captain.operationally_enabled is distinct from true
   then raise exception 'Captain is not eligible' using errcode='42501'; end if;
  if captain.vehicle_type<>(case when r.category='Ride' then 'Car' else r.category end) then raise exception 'Vehicle category does not match'; end if;
  if r.status<>'pending' or r.driver_id is not null or exists(select 1 from public.rides where (driver_id=captain.id or user_id=p_actor) and status in ('driver_assigned','accepted','driver_arrived','started')) then
   raise exception 'Ride or captain already assigned'; end if;
  update public.rides set driver_id=captain.id,status='driver_assigned' where id=p_ride returning * into r;
 elsif p_action in ('confirm','reject') then
  if r.user_id<>p_actor then raise exception 'Only the passenger can perform this action' using errcode='42501'; end if;
  if r.status<>'driver_assigned' then raise exception 'Ride changed. Refresh before retrying'; end if;
  if p_action='confirm' then update public.rides set status='accepted',accepted_at=now() where id=p_ride returning * into r;
  else update public.rides set status='pending',driver_id=null where id=p_ride returning * into r; end if;
 elsif p_action='cancel' then
  if r.user_id<>p_actor and (captain.id is null or r.driver_id is distinct from captain.id) then raise exception 'Not a ride participant' using errcode='42501'; end if;
  if r.status not in ('pending','driver_assigned','accepted','driver_arrived') then raise exception 'This ride cannot be cancelled'; end if;
  update public.rides set status='cancelled',cancelled_at=now() where id=p_ride returning * into r;
 elsif p_action in ('arrive','start','complete') then
  if captain.id is null or r.driver_id is distinct from captain.id then raise exception 'Only the assigned captain can perform this action' using errcode='42501'; end if;
  if p_action='complete' and r.status='completed' then return jsonb_build_object('status','already_completed','ride',to_jsonb(r)); end if;
  if p_action='arrive' and r.status='accepted' then update public.rides set status='driver_arrived',arrived_at=now() where id=p_ride returning * into r;
  elsif p_action='start' and r.status='driver_arrived' then update public.rides set status='started',started_at=now() where id=p_ride returning * into r;
  elsif p_action='complete' and r.status='started' then
   -- Stable lock order prevents two settlement transactions deadlocking wallets.
   perform id from public.profiles where id in (r.user_id,captain.user_id) order by id for update;
   if (select count(*) from public.profiles where id in (r.user_id,captain.user_id))<>2 then raise exception 'Settlement accounts missing'; end if;
   select wallet_balance into wallet from public.profiles where id=r.user_id;
   if r.fare is null or r.fare<=0 or wallet is null or wallet<r.fare then raise exception 'Insufficient wallet balance for settlement'; end if;
   result:=public.complete_ride_transaction(p_ride)::jsonb;
   select * into r from public.rides where id=p_ride;
  else raise exception 'Invalid ride state. Refresh before retrying'; end if;
 else raise exception 'Unsupported ride action'; end if;
 insert into public.ride_events(ride_id,actor_id,action,from_status,to_status) values(p_ride,p_actor,p_action,old_status,r.status);
 return coalesce(result,jsonb_build_object('status','success','ride',to_jsonb(r)));
end; $$;
revoke all on function public.request_ride_secure(uuid,jsonb),public.ride_action_secure(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.request_ride_secure(uuid,jsonb),public.ride_action_secure(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
