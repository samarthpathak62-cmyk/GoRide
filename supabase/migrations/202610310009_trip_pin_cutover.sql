-- Run AFTER backend and both apps support PIN start. Service-only old action no
-- longer permits start; the internal core cannot be called through PostgREST.
alter function public.ride_action_secure(uuid,uuid,text) rename to ride_action_core;
revoke all on function public.ride_action_core(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.ride_action_secure(p_ride uuid,p_actor uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_action='start' then raise exception 'Trip PIN verification required' using errcode='42501'; end if;
 return public.ride_action_core(p_ride,p_actor,p_action);
end; $$;
revoke all on function public.ride_action_secure(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ride_action_secure(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
