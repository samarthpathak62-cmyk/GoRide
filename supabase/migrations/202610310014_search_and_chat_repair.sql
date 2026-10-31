-- Legacy searches have NULL matching deadlines; expire them by creation age.
create or replace function public.expire_ride_searches(p_actor uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rides;old_driver uuid;changed jsonb:='[]';
begin
 for r in select * from public.rides where status in ('pending','driver_assigned') and (p_actor is null or user_id=p_actor) and (coalesce(matching_expires_at,created_at+interval '3 minutes')<=now() or offer_expires_at<=now()) order by id for update skip locked loop
 old_driver:=r.driver_id;
 if coalesce(r.matching_expires_at,r.created_at+interval '3 minutes')<=now() then update public.rides set status='cancelled',cancelled_at=now(),cancellation_reason='no_captain',payment_status='cancelled' where id=r.id returning * into r;
 else update public.rides set status='pending',driver_id=null,offer_expires_at=null where id=r.id returning * into r;end if;
 insert into public.ride_events(ride_id,actor_id,actor_type,action,from_status,to_status) values(r.id,null,'system',case when r.status='cancelled' then 'matching_expired' else 'offer_expired' end,'pending_or_assigned',r.status);
 changed:=changed||jsonb_build_array(to_jsonb(r)||jsonb_build_object('previousDriverId',old_driver));
 end loop;return changed;
end;$$;

-- Every future legacy or quoted insert gets a real deadline and one active trip.
create function public.guard_new_search() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='pending' then
  perform pg_advisory_xact_lock(hashtextextended('ride-user:'||new.user_id::text,0));
  if exists(select 1 from public.rides where user_id=new.user_id and status in ('pending','driver_assigned','accepted','driver_arrived','started')) then
   raise exception 'An active trip already exists';
  end if;
  new.matching_expires_at:=coalesce(new.matching_expires_at,now()+interval '3 minutes');
 end if;
 return new;
end;$$;
create trigger new_search_guard before insert on public.rides for each row execute function public.guard_new_search();
revoke all on function public.guard_new_search() from public,anon,authenticated;
-- Enforce messaging eligibility at INSERT as well as in HTTP/socket handlers.
-- Share-lock the trip so a simultaneous cancellation/completion serializes here.
create function public.guard_trip_message() returns trigger language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 select r.id into rid from public.rides r join public.drivers d on d.id=r.driver_id
 where r.status in ('driver_assigned','accepted','driver_arrived','started')
 and ((r.user_id=new.sender_id and d.user_id=new.receiver_id) or (r.user_id=new.receiver_id and d.user_id=new.sender_id))
 order by r.created_at desc limit 1 for share of r;
 if rid is null then raise exception 'Chat is closed. A shared active trip is required' using errcode='42501';end if;
 return new;
end;$$;
create trigger active_trip_messages before insert on public.messages for each row execute function public.guard_trip_message();
revoke all on function public.guard_trip_message() from public,anon,authenticated;
alter table public.messages enable row level security;
revoke all on public.messages from public,anon,authenticated;
grant all on public.messages to service_role;
revoke all on function public.get_user_conversations(uuid) from public,anon,authenticated;
grant execute on function public.get_user_conversations(uuid) to service_role;
-- Close stale searches only, with system audit events. Never touch completed rides or balances.
do $$begin perform public.expire_ride_searches();end;$$;
notify pgrst,'reload schema';

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
