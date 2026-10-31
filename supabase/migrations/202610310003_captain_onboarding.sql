-- Deploy the matching backend/APKs before applying this access-control migration.
alter table public.drivers add column if not exists registration_number text;
alter table public.drivers add column if not exists documents jsonb not null default '{}';
alter table public.drivers add column if not exists review_version integer not null default 0;
alter table public.drivers add column if not exists review_reason text;
alter table public.drivers add column if not exists operationally_enabled boolean not null default false;
create table if not exists public.driver_application_drafts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 payload jsonb not null default '{}', updated_at timestamptz not null default now()
);
alter table public.driver_application_drafts enable row level security;
create policy captain_draft_owner on public.driver_application_drafts for all to authenticated
 using (user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert,update,delete on public.driver_application_drafts to authenticated;
grant all on public.driver_application_drafts to service_role;
alter table public.drivers enable row level security;
create policy captain_read_own_application on public.drivers for select to authenticated using(user_id=auth.uid());
revoke insert,update,delete on public.drivers from anon,authenticated;
grant select on public.drivers to authenticated;
grant all on public.drivers to service_role;
create table public.captain_review_audit (
 id uuid primary key default gen_random_uuid(),applicant_id uuid not null,reviewer_id uuid not null,
 from_status text,to_status text not null,reason text not null,review_version integer not null,
 created_at timestamptz not null default now()
);
alter table public.captain_review_audit enable row level security;
revoke all on public.captain_review_audit from anon,authenticated;
grant select,insert on public.captain_review_audit to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('captain-documents','captain-documents',false,5242880,array['image/jpeg','image/png','image/webp'])
 on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
create policy captain_document_insert on storage.objects for insert to authenticated
 with check(bucket_id='captain-documents' and (storage.foldername(name))[1]=auth.uid()::text);
create policy captain_document_read on storage.objects for select to authenticated
 using(bucket_id='captain-documents' and (storage.foldername(name))[1]=auth.uid()::text);
-- No overwrite/delete: reviewed evidence cannot be replaced behind a reviewer.
create or replace function public.submit_captain_application(p_user_id uuid,p_application jsonb)
returns public.drivers language plpgsql security definer set search_path='' as $$
declare d public.drivers;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 select * into d from public.drivers where user_id=p_user_id for update;
 if found and d.status in ('pending','approved') then raise exception 'Application already submitted'; end if;
 insert into public.drivers(user_id,full_name,date_of_birth,vehicle_model,vehicle_type,city,postal_code,registration_number,documents,status,is_online,operationally_enabled,review_version)
 values(p_user_id,p_application->>'full_name',(p_application->>'date_of_birth')::date,p_application->>'vehicle_model',p_application->>'vehicle_type',p_application->>'city',p_application->>'postal_code',p_application->>'registration_number',p_application->'documents','pending',false,false,1)
 on conflict(user_id) do update set full_name=excluded.full_name,date_of_birth=excluded.date_of_birth,
 vehicle_model=excluded.vehicle_model,vehicle_type=excluded.vehicle_type,city=excluded.city,postal_code=excluded.postal_code,
 registration_number=excluded.registration_number,documents=excluded.documents,status='pending',is_online=false,
 operationally_enabled=false,review_reason=null,review_version=public.drivers.review_version+1,last_updated=now()
 returning * into d;
 return d;
end; $$;
revoke all on function public.submit_captain_application(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.submit_captain_application(uuid,jsonb) to service_role;
create or replace function public.review_captain_application(p_user_id uuid,p_reviewer_id uuid,p_version integer,p_status text,p_reason text,p_compliance boolean)
returns public.drivers language plpgsql security definer set search_path='' as $$
declare d public.drivers;
begin
 if p_status not in ('approved','rejected') or length(trim(p_reason))<5 then raise exception 'Invalid review'; end if;
 if p_status='approved' and not p_compliance then raise exception 'Compliance confirmation required'; end if;
 select * into d from public.drivers where user_id=p_user_id for update;
 if not found or d.status<>'pending' or p_version is null or d.review_version<>p_version then raise exception 'Application changed; reload'; end if;
 insert into public.captain_review_audit(applicant_id,reviewer_id,from_status,to_status,reason,review_version)
 values(p_user_id,p_reviewer_id,d.status,p_status,p_reason,p_version);
 update public.drivers set status=p_status,review_reason=p_reason,review_version=review_version+1,
 operationally_enabled=(p_status='approved' and p_compliance),is_online=false,last_updated=now()
 where user_id=p_user_id returning * into d;
 return d;
end; $$;
revoke all on function public.review_captain_application(uuid,uuid,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.review_captain_application(uuid,uuid,integer,text,text,boolean) to service_role;
notify pgrst,'reload schema';
