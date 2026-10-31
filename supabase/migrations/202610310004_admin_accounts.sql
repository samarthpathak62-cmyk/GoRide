-- Privileged email reservations; no shared/default admin password.
create table public.admin_access_grants (
 email text primary key check(email=lower(email)),
 user_id uuid,
 status text not null default 'pending' check(status in ('pending','active','revoked')),
 granted_by uuid,
 created_at timestamptz not null default now()
);
alter table public.admin_access_grants enable row level security;
revoke all on public.admin_access_grants from public,anon,authenticated;
grant all on public.admin_access_grants to service_role;
create table public.admin_account_audit (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null,
 target_email text not null,action text not null,created_at timestamptz not null default now()
);
alter table public.admin_account_audit enable row level security;
revoke all on public.admin_account_audit from public,anon,authenticated;
grant select,insert on public.admin_account_audit to service_role;
create or replace function public.activate_reserved_admin()
returns trigger language plpgsql security definer set search_path='' as $$
declare g public.admin_access_grants;
begin
 if new.email_confirmed_at is null then return new; end if;
 select * into g from public.admin_access_grants where email=lower(new.email) for update;
 if found and ((g.status='pending' and (g.user_id is null or g.user_id=new.id)) or (g.status='active' and g.user_id=new.id)) then
  new.raw_app_meta_data:=coalesce(new.raw_app_meta_data,'{}'::jsonb)||'{"role":"admin"}'::jsonb;
  update public.admin_access_grants set status='active',user_id=new.id where email=g.email;
 end if;
 return new;
end; $$;
revoke all on function public.activate_reserved_admin() from public,anon,authenticated;
create trigger activate_reserved_admin before insert or update of email,email_confirmed_at
 on auth.users for each row execute function public.activate_reserved_admin();
create or replace function public.admin_lookup_account(p_email text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'email',email,'verified',email_confirmed_at is not null,'app_metadata',raw_app_meta_data)
 from auth.users where lower(email)=lower(p_email) limit 1;
$$;
revoke all on function public.admin_lookup_account(text) from public,anon,authenticated;
grant execute on function public.admin_lookup_account(text) to service_role;
notify pgrst,'reload schema';
-- A reservation grants no access until the email owner verifies it. Exposes no list.
create or replace function public.admin_signup_allowed(p_email text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.admin_access_grants where email=lower(p_email) and status='pending');
$$;
revoke all on function public.admin_signup_allowed(text) from public;
grant execute on function public.admin_signup_allowed(text) to anon,authenticated,service_role;
