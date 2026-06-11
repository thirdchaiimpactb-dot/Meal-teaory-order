-- storage bucket สำหรับรูปภาพเมนู (public read, staff write)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-images',
  'menu-images',
  true,
  5242880,  -- 5 MB
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do nothing;

create policy "public read menu images"
  on storage.objects for select
  using (bucket_id = 'menu-images');

create policy "staff upload menu images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-images');

create policy "staff update menu images"
  on storage.objects for update to authenticated
  using (bucket_id = 'menu-images');

create policy "staff delete menu images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'menu-images');
