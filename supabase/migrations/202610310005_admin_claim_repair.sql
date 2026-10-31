-- GoTrue may rewrite app metadata during email confirmation. Reassert only
-- trusted, bound, verified grants on metadata writes as well as confirmation.
drop trigger activate_reserved_admin on auth.users;
create trigger activate_reserved_admin
 before insert or update of email,email_confirmed_at,raw_app_meta_data
 on auth.users for each row execute function public.activate_reserved_admin();
update auth.users u
 set raw_app_meta_data=coalesce(u.raw_app_meta_data,'{}'::jsonb)||'{"role":"admin"}'::jsonb
 from public.admin_access_grants g
 where g.email=lower(u.email) and g.user_id=u.id and g.status='active'
 and u.email_confirmed_at is not null;
