-- Запустить один раз в Supabase SQL Editor после базовой схемы.
-- Автоматически создаёт профиль после регистрации и добавляет недостающие RLS-политики.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, city, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), ''),
    coalesce(new.raw_user_meta_data->>'city', 'Москва'),
    coalesce(new.raw_user_meta_data->>'role', 'customer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Пользователь может создать свой профиль вручную, если аккаунт появился до установки триггера.
drop policy if exists "profiles self insert" on public.profiles;
create policy "profiles self insert" on public.profiles
for insert with check (auth.uid() = id);

-- Разрешаем владельцу удалять свои записи и читать собственные неактивные услуги/задачи.
-- Базовые owner-write политики уже покрывают insert/update/delete.

-- Storage bucket для аватаров (публичное чтение, загрузка только в свою папку).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
for select using (bucket_id = 'avatars');

drop policy if exists "avatars self upload" on storage.objects;
create policy "avatars self upload" on storage.objects
for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars self update" on storage.objects;
create policy "avatars self update" on storage.objects
for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
