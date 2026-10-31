-- Additive avatar storage; contains NO identity documents.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-photos','profile-photos',true,2097152,array['image/jpeg','image/png'])
on conflict(id) do update set public=true,file_size_limit=2097152,allowed_mime_types=excluded.allowed_mime_types;
create policy profile_photo_insert_self on storage.objects for insert to authenticated
 with check(bucket_id='profile-photos' and (storage.foldername(name))[1]=auth.uid()::text);
-- Photos are intentionally public avatars, never identity documents.
notify pgrst,'reload schema';
