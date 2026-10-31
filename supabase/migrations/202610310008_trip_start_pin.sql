-- Additive: deploy API and both PIN-enabled apps before applying 009.
create table public.trip_start_pins (
 ride_id uuid primary key references public.rides(id) on delete cascade,
 rider_id uuid not null, driver_id uuid not null, pin_digest text not null,
 sealed_pin text not null, failures integer not null default 0,
 generations integer not null default 1, issued_at timestamptz not null default now(),
 expires_at timestamptz not null, consumed_at timestamptz
);
alter table public.trip_start_pins enable row level security;
revoke all on public.trip_start_pins from public,anon,authenticated;
grant all on public.trip_start_pins to service_role;

create or replace function public.issue_trip_pin(p_ride uuid,p_actor uuid,p_digest text,p_sealed text,p_rotate boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rides; p public.trip_start_pins; count_generations integer:=1;
begin
 select * into r from public.rides where id=p_ride for update;
 if not found or p_actor is null or r.user_id is distinct from p_actor then return jsonb_build_object('code','ACCESS_DENIED'); end if;
 if r.status not in ('accepted','driver_arrived') or r.driver_id is null then return jsonb_build_object('code','TRIP_NOT_READY'); end if;
 select * into p from public.trip_start_pins where ride_id=p_ride for update;
 if found then
  if p.driver_id=r.driver_id and p.expires_at>now() and not p_rotate then
   if p.failures>=5 then return jsonb_build_object('code','PIN_LOCKED'); end if;
   return jsonb_build_object('sealed',p.sealed_pin,'driverId',p.driver_id,'expiresAt',p.expires_at,'attemptsRemaining',5-p.failures);
  end if;
  if p.issued_at>now()-interval '60 seconds' then return jsonb_build_object('code','PIN_COOLDOWN'); end if;
  count_generations:=p.generations+1;
  if count_generations>5 then return jsonb_build_object('code','PIN_GENERATION_LIMIT'); end if;
 end if;
 if p_digest is null or length(p_digest)<>64 or p_sealed is null or length(p_sealed)>1024 then raise exception 'Invalid PIN envelope'; end if;
 insert into public.trip_start_pins(ride_id,rider_id,driver_id,pin_digest,sealed_pin,generations,expires_at)
 values(p_ride,p_actor,r.driver_id,p_digest,p_sealed,count_generations,now()+interval '15 minutes')
 on conflict(ride_id) do update set rider_id=excluded.rider_id,driver_id=excluded.driver_id,
 pin_digest=excluded.pin_digest,sealed_pin=excluded.sealed_pin,failures=0,generations=excluded.generations,
 issued_at=now(),expires_at=excluded.expires_at,consumed_at=null returning * into p;
 insert into public.ride_events(ride_id,actor_id,action,from_status,to_status) values(p_ride,p_actor,'pin_issued',r.status,r.status);
 return jsonb_build_object('sealed',p.sealed_pin,'driverId',p.driver_id,'expiresAt',p.expires_at,'attemptsRemaining',5);
end; $$;

create or replace function public.start_trip_with_pin(p_ride uuid,p_actor uuid,p_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rides; p public.trip_start_pins; captain uuid;
begin
 if p_actor is null then return jsonb_build_object('code','ACCESS_DENIED'); end if;
 perform pg_advisory_xact_lock(hashtextextended('ride-user:'||p_actor::text,0));
 select * into r from public.rides where id=p_ride for update;
 select id into captain from public.drivers where user_id=p_actor and status='approved' and operationally_enabled is true;
 if r.id is null or captain is null or r.driver_id is distinct from captain then return jsonb_build_object('code','ACCESS_DENIED'); end if;
 if r.status='started' then return jsonb_build_object('status','already_started'); end if;
 if r.status<>'driver_arrived' then return jsonb_build_object('code','TRIP_NOT_READY'); end if;
 select * into p from public.trip_start_pins where ride_id=p_ride for update;
 if not found or p.driver_id is distinct from captain or p.rider_id is distinct from r.user_id then return jsonb_build_object('code','PIN_REQUIRED'); end if;
 if p.failures>=5 then return jsonb_build_object('code','PIN_LOCKED'); end if;
 if p.expires_at<=now() then return jsonb_build_object('code','PIN_EXPIRED'); end if;
 if p_digest is distinct from p.pin_digest then
  update public.trip_start_pins set failures=failures+1 where ride_id=p_ride returning * into p;
  insert into public.ride_events(ride_id,actor_id,action,from_status,to_status) values(p_ride,p_actor,case when p.failures>=5 then 'pin_locked' else 'pin_failed' end,r.status,r.status);
  -- Return, don't RAISE: failed attempts MUST remain committed.
  return jsonb_build_object('code',case when p.failures>=5 then 'PIN_LOCKED' else 'PIN_INVALID' end,'attemptsRemaining',greatest(0,5-p.failures));
 end if;
 update public.trip_start_pins set consumed_at=now() where ride_id=p_ride;
 update public.rides set status='started',started_at=now() where id=p_ride;
 insert into public.ride_events(ride_id,actor_id,action,from_status,to_status) values(p_ride,p_actor,'start_with_pin','driver_arrived','started');
 return jsonb_build_object('status','success');
end; $$;
revoke all on function public.issue_trip_pin(uuid,uuid,text,text,boolean),public.start_trip_with_pin(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.issue_trip_pin(uuid,uuid,text,text,boolean),public.start_trip_with_pin(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
