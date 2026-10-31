-- Integrated booking/dispatch/cash/support preparation. New APIs use these RPCs.
alter table public.rides add column payment_method text not null default 'wallet' check(payment_method in ('wallet','cash'));
alter table public.rides add column payment_status text not null default 'pending';
alter table public.rides add column matching_expires_at timestamptz;
alter table public.rides add column offer_expires_at timestamptz;
alter table public.rides add column cancellation_reason text;
alter table public.ride_events alter column actor_id drop not null;
alter table public.ride_events add column actor_type text not null default 'user';
create table public.fare_quotes(id uuid primary key default gen_random_uuid(),user_id uuid not null,payload jsonb not null,expires_at timestamptz not null default now()+interval '2 minutes',ride_id uuid unique,created_at timestamptz not null default now());
alter table public.rides add column quote_id uuid unique references public.fare_quotes(id);
create table public.ride_dispatch_offers(id uuid primary key default gen_random_uuid(),ride_id uuid not null references public.rides(id),driver_id uuid not null references public.drivers(id),expires_at timestamptz not null default now()+interval '30 seconds',created_at timestamptz not null default now(),unique(ride_id,driver_id));
create table public.captain_cash_ledger(ride_id uuid primary key references public.rides(id),captain_user_id uuid not null,cash_received numeric not null check(cash_received>0),commission_due numeric not null check(commission_due>=0),captain_net numeric not null,created_at timestamptz not null default now());
create table public.support_tickets(id uuid primary key default gen_random_uuid(),user_id uuid not null,ride_id uuid references public.rides(id),category text not null check(category in ('trip','payment','refund_request','safety','account')),message text not null,status text not null default 'open' check(status in ('open','in_progress','resolved')),reply text,responded_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.safety_alerts(id uuid primary key default gen_random_uuid(),ride_id uuid not null references public.rides(id),user_id uuid not null,status text not null default 'open' check(status in ('open','acknowledged','closed')),created_at timestamptz not null default now(),handled_by uuid);
create table public.trip_share_links(token_hash text primary key,ride_id uuid not null references public.rides(id),user_id uuid not null,expires_at timestamptz not null default now()+interval '30 minutes',unique(ride_id,user_id));
do $$ declare t text; begin foreach t in array array['fare_quotes','ride_dispatch_offers','captain_cash_ledger','support_tickets','safety_alerts','trip_share_links'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end;$$;
create index matching_pending on public.rides(matching_expires_at) where status in ('pending','driver_assigned');
create index support_owner_created on public.support_tickets(user_id,created_at);

create function public.book_quoted_ride(p_actor uuid,p_quote uuid,p_method text) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.fare_quotes;r public.rides;v jsonb;balance numeric;
begin
 if p_actor is null or p_method not in ('cash','wallet') then raise exception 'Invalid booking';end if;
 perform pg_advisory_xact_lock(hashtextextended('ride-user:'||p_actor::text,0));
 select * into q from public.fare_quotes where id=p_quote for update;
 if not found or q.user_id is distinct from p_actor then raise exception 'Quote unavailable' using errcode='42501';end if;
 if q.ride_id is not null then select * into r from public.rides where id=q.ride_id;if r.payment_method<>p_method then raise exception 'Quote already used with another payment method';end if;return to_jsonb(r);end if;
 if q.expires_at<=now() then raise exception 'Quote expired. Refresh fare';end if;
 if exists(select 1 from public.rides where (user_id=p_actor or driver_id in(select id from public.drivers where user_id=p_actor)) and status in ('pending','driver_assigned','accepted','driver_arrived','started')) then raise exception 'Active trip already exists';end if;
 v:=q.payload;if (v->>'fare') is null or (v->>'fare')::numeric<=0 then raise exception 'Invalid fare';end if;
 select wallet_balance into balance from public.profiles where id=p_actor for update;
 if balance is null or (p_method='wallet' and balance<(v->>'fare')::numeric) then raise exception 'Insufficient wallet balance. Choose cash or add funds';end if;
 insert into public.rides(user_id,pickup_location,drop_location,category,fare,pickup_latitude,pickup_longitude,drop_latitude,drop_longitude,pickup_coords,drop_coords,status,payment_method,quote_id,matching_expires_at)
 values(p_actor,v->>'pickupLocation',v->>'dropLocation',v->>'category',(v->>'fare')::numeric,(v->>'pickupLatitude')::float8,(v->>'pickupLongitude')::float8,(v->>'dropLatitude')::float8,(v->>'dropLongitude')::float8,('POINT('||(v->>'pickupLongitude')||' '||(v->>'pickupLatitude')||')')::extensions.geography,('POINT('||(v->>'dropLongitude')||' '||(v->>'dropLatitude')||')')::extensions.geography,'pending',p_method,p_quote,now()+interval '3 minutes') returning * into r;
 update public.fare_quotes set ride_id=r.id where id=q.id;
 insert into public.ride_events(ride_id,actor_id,action,to_status) values(r.id,p_actor,'quoted_booking','pending');return to_jsonb(r);
end;$$;

create function public.expire_ride_searches(p_actor uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rides;old_driver uuid;changed jsonb:='[]';
begin
 for r in select * from public.rides where status in ('pending','driver_assigned') and (p_actor is null or user_id=p_actor) and (matching_expires_at<=now() or offer_expires_at<=now()) order by id for update skip locked loop
 old_driver:=r.driver_id;
 if r.matching_expires_at<=now() then update public.rides set status='cancelled',cancelled_at=now(),cancellation_reason='no_captain',payment_status='cancelled' where id=r.id returning * into r;
 else update public.rides set status='pending',driver_id=null,offer_expires_at=null where id=r.id returning * into r;end if;
 insert into public.ride_events(ride_id,actor_id,actor_type,action,from_status,to_status) values(r.id,null,'system',case when r.status='cancelled' then 'matching_expired' else 'offer_expired' end,'pending_or_assigned',r.status);
 changed:=changed||jsonb_build_array(to_jsonb(r)||jsonb_build_object('previousDriverId',old_driver));
 end loop;return changed;
end;$$;

create function public.claim_ride_offers(p_ride uuid,p_drivers uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rides;result jsonb;
begin
 select * into r from public.rides where id=p_ride for update;
 if not found or r.status<>'pending' or r.matching_expires_at<=now() then return '[]';end if;
 with offered as(insert into public.ride_dispatch_offers(ride_id,driver_id,expires_at)
 select p_ride,d.id,least(r.matching_expires_at,now()+interval '30 seconds') from public.drivers d where d.id=any(p_drivers) and d.is_online and d.status='approved' and d.operationally_enabled and d.user_id<>r.user_id and not exists(select 1 from public.rides x where x.driver_id=d.id and x.status in ('driver_assigned','accepted','driver_arrived','started')) order by d.id limit 20 on conflict do nothing returning *)
 select coalesce(jsonb_agg(jsonb_build_object('driverId',o.driver_id,'userId',d.user_id,'expiresAt',o.expires_at)),'[]'::jsonb) into result from offered o join public.drivers d on d.id=o.driver_id;
 return result;
end;$$;

create function public.booking_state_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.quote_id is not null and new.status is distinct from old.status then
 if new.status in ('driver_assigned','accepted') and new.matching_expires_at<=now() then raise exception 'Matching window expired';end if;
 if new.status='driver_assigned' then
 if not exists(select 1 from public.ride_dispatch_offers where ride_id=new.id and driver_id=new.driver_id and expires_at>now()) then raise exception 'Captain offer expired or not offered';end if;
 new.offer_expires_at:=least(new.matching_expires_at,now()+interval '45 seconds');
 elsif new.status='accepted' and old.offer_expires_at<=now() then raise exception 'Passenger confirmation window expired';
 end if;
 if new.status='pending' and old.driver_id is not null then update public.ride_dispatch_offers set expires_at=now() where ride_id=new.id and driver_id=old.driver_id;end if;
 if new.status='completed' and new.payment_method='cash' and not exists(select 1 from public.captain_cash_ledger where ride_id=new.id) then raise exception 'Explicit cash collection confirmation required';end if;
 end if;return new;
end;$$;
create trigger booking_state_guard before update of status on public.rides for each row execute function public.booking_state_guard();

create function public.settle_ride_v2(p_actor uuid,p_ride uuid,p_cash_collected boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rides;captain uuid;result jsonb;fee numeric;
begin
 if p_actor is null then raise exception 'Actor required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('ride-user:'||p_actor::text,0));
 select * into r from public.rides where id=p_ride for update;select id into captain from public.drivers where user_id=p_actor;
 if r.id is null or captain is null or r.driver_id is distinct from captain then raise exception 'Assigned captain required' using errcode='42501';end if;
 if r.status='completed' then return jsonb_build_object('status','already_completed','ride',to_jsonb(r));end if;
 if r.status<>'started' then raise exception 'Trip must be started';end if;
 if r.payment_method='cash' then
 if p_cash_collected is distinct from true then raise exception 'Confirm cash has actually been collected';end if;
 fee:=round(r.fare*0.2,2);
 insert into public.captain_cash_ledger(ride_id,captain_user_id,cash_received,commission_due,captain_net) values(r.id,p_actor,r.fare,fee,r.fare-fee);
 update public.rides set status='completed',completed_at=now(),payment_status='cash_collected' where id=r.id returning * into r;
 insert into public.ride_events(ride_id,actor_id,action,from_status,to_status) values(r.id,p_actor,'cash_collected','started','completed');
 return jsonb_build_object('status','success','ride',to_jsonb(r));
 else
 result:=public.ride_action_secure(p_ride,p_actor,'complete');
 update public.rides set payment_status='wallet_paid' where id=p_ride returning * into r;
 return jsonb_build_object('status',result->>'status','ride',to_jsonb(r));
 end if;
end;$$;

revoke all on function public.book_quoted_ride(uuid,uuid,text),public.expire_ride_searches(uuid),public.claim_ride_offers(uuid,uuid[]),public.settle_ride_v2(uuid,uuid,boolean),public.booking_state_guard() from public,anon,authenticated;
grant execute on function public.book_quoted_ride(uuid,uuid,text),public.expire_ride_searches(uuid),public.claim_ride_offers(uuid,uuid[]),public.settle_ride_v2(uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
