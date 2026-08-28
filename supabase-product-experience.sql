-- ПОМОГАЙ: расширение продукта после supabase-security-hardening.sql.
-- Сначала проверить в отдельном Supabase-проекте. Скрипт не удаляет данные.

begin;

alter table public.profiles
  add column if not exists bio text,
  add column if not exists languages text,
  add column if not exists experience_years integer;

alter table public.services add column if not exists subcategory text;
alter table public.tasks add column if not exists subcategory text;
alter table public.conversations add column if not exists kind text not null default 'task';

create table if not exists public.profile_private (
  id uuid primary key references public.profiles(id) on delete cascade,
  birth_date date,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profile_private enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_product_fields_limits') then
    alter table public.profiles add constraint profiles_product_fields_limits check (
      (bio is null or char_length(bio) <= 1000)
      and (languages is null or char_length(languages) <= 200)
      and (experience_years is null or experience_years between 0 and 80)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'services_subcategory_limit') then
    alter table public.services add constraint services_subcategory_limit
      check (subcategory is null or char_length(subcategory) <= 120) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_subcategory_limit') then
    alter table public.tasks add constraint tasks_subcategory_limit
      check (subcategory is null or char_length(subcategory) <= 120) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversations_kind_values') then
    alter table public.conversations add constraint conversations_kind_values
      check (kind in ('task', 'direct')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversations_context_valid') then
    alter table public.conversations add constraint conversations_context_valid
      check ((kind = 'task' and task_id is not null) or (kind = 'direct' and task_id is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profile_private_limits') then
    alter table public.profile_private add constraint profile_private_limits check (
      (birth_date is null or birth_date between date '1900-01-01' and date '2100-12-31')
      and (phone is null or char_length(phone) <= 30)
    ) not valid;
  end if;
end
$$;

create unique index if not exists conversations_direct_pair_uidx
  on public.conversations (least(customer_id, helper_id), greatest(customer_id, helper_id))
  where kind = 'direct';

create or replace function public.protect_verified_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.verified
    and new.name is distinct from old.name
    and coalesce(auth.role(), '') <> 'service_role'
  then
    raise exception 'verified identity fields can only be changed by support';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_verified_identity on public.profiles;
create trigger profiles_protect_verified_identity
before update on public.profiles
for each row execute function public.protect_verified_identity();

create or replace function public.protect_private_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p where p.id = old.id and p.verified)
    and new.birth_date is distinct from old.birth_date
    and coalesce(auth.role(), '') <> 'service_role'
  then
    raise exception 'verified identity fields can only be changed by support';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profile_private_protect_identity on public.profile_private;
create trigger profile_private_protect_identity
before update on public.profile_private
for each row execute function public.protect_private_identity();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_birth_date date;
begin
  insert into public.profiles (id, name, city, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), ''),
    coalesce(new.raw_user_meta_data->>'city', 'Москва'),
    'customer'
  )
  on conflict (id) do nothing;

  begin
    requested_birth_date := nullif(new.raw_user_meta_data->>'birth_date', '')::date;
  exception when others then
    requested_birth_date := null;
  end;

  insert into public.profile_private (id, birth_date)
  values (new.id, requested_birth_date)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on table public.profile_private from anon, authenticated;
grant select, insert, update on table public.profile_private to authenticated;
grant update (bio, languages, experience_years) on table public.profiles to authenticated;
grant insert (subcategory), update (subcategory) on table public.services to authenticated;
grant insert (subcategory), update (subcategory) on table public.tasks to authenticated;
grant insert (kind) on table public.conversations to authenticated;

drop policy if exists "profile private self read" on public.profile_private;
drop policy if exists "profile private self insert" on public.profile_private;
drop policy if exists "profile private self update" on public.profile_private;
create policy "profile private self read" on public.profile_private for select to authenticated
  using ((select auth.uid()) = id);
create policy "profile private self insert" on public.profile_private for insert to authenticated
  with check ((select auth.uid()) = id);
create policy "profile private self update" on public.profile_private for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "conversations participants insert" on public.conversations;
create policy "conversations participants insert" on public.conversations for insert to authenticated
with check (
  (select auth.uid()) in (customer_id, helper_id)
  and (
    (
      kind = 'direct'
      and task_id is null
      and exists (select 1 from public.profiles p where p.id = customer_id)
      and exists (select 1 from public.profiles p where p.id = helper_id)
    )
    or
    (
      kind = 'task'
      and exists (
        select 1 from public.tasks t
        where t.id = task_id and t.customer_id = customer_id
      )
      and exists (
        select 1 from public.responses r
        where r.task_id = task_id and r.helper_id = helper_id and r.status = 'accepted'
      )
    )
  )
);

create or replace function public.start_direct_conversation(other_user uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  first_user uuid;
  second_user uuid;
  conversation_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if other_user is null or other_user = current_user_id then
    raise exception 'invalid conversation participant';
  end if;
  if not exists (select 1 from public.profiles p where p.id = other_user) then
    raise exception 'profile not found';
  end if;

  first_user := least(current_user_id, other_user);
  second_user := greatest(current_user_id, other_user);

  select c.id into conversation_id
  from public.conversations c
  where c.kind = 'direct'
    and least(c.customer_id, c.helper_id) = first_user
    and greatest(c.customer_id, c.helper_id) = second_user
  limit 1;

  if conversation_id is null then
    begin
      insert into public.conversations (task_id, customer_id, helper_id, kind)
      values (null, first_user, second_user, 'direct')
      returning id into conversation_id;
    exception when unique_violation then
      select c.id into conversation_id
      from public.conversations c
      where c.kind = 'direct'
        and least(c.customer_id, c.helper_id) = first_user
        and greatest(c.customer_id, c.helper_id) = second_user
      limit 1;
    end;
  end if;
  return conversation_id;
end;
$$;

revoke all on function public.start_direct_conversation(uuid) from public, anon;
grant execute on function public.start_direct_conversation(uuid) to authenticated;

commit;
