-- ПОМОГАЙ: усиление RLS и прав доступа.
-- ВАЖНО: сначала проверить в отдельной ветке Supabase и только потом применять к production.
-- Скрипт не удаляет пользовательские данные.

begin;

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'avatars';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, city, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), ''),
    coalesce(new.raw_user_meta_data->>'city', 'Москва'),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists services_set_updated_at on public.services;
create trigger services_set_updated_at before update on public.services
for each row execute function public.set_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.tasks enable row level security;
alter table public.responses enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.favorites enable row level security;
alter table public.reports enable row level security;
alter table public.subscriptions enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_rating_range') then
    alter table public.profiles add constraint profiles_rating_range check (rating between 0 and 5) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_content_limits') then
    alter table public.profiles add constraint profiles_content_limits check (
      char_length(name) <= 120
      and (city is null or char_length(city) <= 120)
      and role in ('customer', 'helper', 'admin')
      and legal_status in ('private', 'self_employed', 'ip', 'company')
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'services_content_limits') then
    alter table public.services add constraint services_content_limits check (
      char_length(title) between 3 and 120
      and char_length(description) between 10 and 4000
      and (price_from is null or price_from >= 0)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'services_operational_limits') then
    alter table public.services add constraint services_operational_limits check (
      (city is null or char_length(city) <= 120)
      and (latitude is null or latitude between -90 and 90)
      and (longitude is null or longitude between -180 and 180)
      and (response_minutes is null or response_minutes between 1 and 10080)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_content_limits') then
    alter table public.tasks add constraint tasks_content_limits check (
      char_length(title) between 3 and 120
      and char_length(description) between 10 and 4000
      and (budget is null or budget >= 0)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_operational_limits') then
    alter table public.tasks add constraint tasks_operational_limits check (
      (address is null or char_length(address) <= 200)
      and (latitude is null or latitude between -90 and 90)
      and (longitude is null or longitude between -180 and 180)
      and status in ('draft', 'open', 'assigned', 'done', 'cancelled')
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'responses_content_limits') then
    alter table public.responses add constraint responses_content_limits check (
      (price is null or price >= 0)
      and (message is null or char_length(message) <= 4000)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'responses_status_values') then
    alter table public.responses add constraint responses_status_values
    check (status in ('pending', 'accepted', 'declined')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversations_distinct_participants') then
    alter table public.conversations add constraint conversations_distinct_participants
    check (customer_id <> helper_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_body_limits') then
    alter table public.messages add constraint messages_body_limits
    check (char_length(body) between 1 and 4000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reports_content_limits') then
    alter table public.reports add constraint reports_content_limits check (
      char_length(reason) between 3 and 120
      and (details is null or char_length(details) <= 4000)
      and status in ('new', 'reviewing', 'resolved', 'rejected')
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_status_values') then
    alter table public.subscriptions add constraint subscriptions_status_values
    check (status in ('pending', 'active', 'past_due', 'cancelled', 'expired')) not valid;
  end if;
end
$$;

revoke all on table public.profiles, public.services, public.tasks, public.responses,
  public.conversations, public.messages, public.favorites, public.reports,
  public.subscriptions from anon, authenticated;

grant select on table public.profiles, public.services, public.tasks to anon, authenticated;
grant insert (id, name, city, avatar_url) on table public.profiles to authenticated;
grant update (name, city, avatar_url) on table public.profiles to authenticated;
grant insert (owner_id, title, category, description, price_from, city, latitude, longitude, response_minutes, is_active)
  on table public.services to authenticated;
grant update (title, category, description, price_from, city, latitude, longitude, response_minutes, is_active)
  on table public.services to authenticated;
grant delete on table public.services to authenticated;
grant insert (customer_id, title, category, description, budget, address, latitude, longitude, scheduled_at, status)
  on table public.tasks to authenticated;
grant update (title, category, description, budget, address, latitude, longitude, scheduled_at, status)
  on table public.tasks to authenticated;
grant delete on table public.tasks to authenticated;
grant select on table public.responses, public.conversations, public.messages to authenticated;
grant insert (task_id, helper_id, price, message) on table public.responses to authenticated;
grant update (status) on table public.responses to authenticated;
grant insert (task_id, customer_id, helper_id) on table public.conversations to authenticated;
grant insert (conversation_id, sender_id, body) on table public.messages to authenticated;
grant update (read_at) on table public.messages to authenticated;
grant select on table public.favorites to authenticated;
grant insert (user_id, service_id) on table public.favorites to authenticated;
grant delete on table public.favorites to authenticated;
grant insert (reporter_id, target_user_id, reason, details) on table public.reports to authenticated;
grant select on table public.subscriptions to authenticated;
grant usage, select on sequence public.messages_id_seq to authenticated;

drop policy if exists "profiles public read" on public.profiles;
drop policy if exists "profiles self insert" on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles public read" on public.profiles for select to anon, authenticated using (true);
create policy "profiles self insert" on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);
create policy "profiles self update" on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "services public read" on public.services;
drop policy if exists "services owner write" on public.services;
drop policy if exists "services owner insert" on public.services;
drop policy if exists "services owner update" on public.services;
drop policy if exists "services owner delete" on public.services;
create policy "services public read" on public.services for select to anon, authenticated
using (is_active = true or (select auth.uid()) = owner_id);
create policy "services owner insert" on public.services for insert to authenticated
with check ((select auth.uid()) = owner_id);
create policy "services owner update" on public.services for update to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "services owner delete" on public.services for delete to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "tasks public read" on public.tasks;
drop policy if exists "tasks owner write" on public.tasks;
drop policy if exists "tasks owner insert" on public.tasks;
drop policy if exists "tasks owner update" on public.tasks;
drop policy if exists "tasks owner delete" on public.tasks;
create policy "tasks public read" on public.tasks for select to anon, authenticated
using (status = 'open' or (select auth.uid()) = customer_id);
create policy "tasks owner insert" on public.tasks for insert to authenticated
with check ((select auth.uid()) = customer_id);
create policy "tasks owner update" on public.tasks for update to authenticated
using ((select auth.uid()) = customer_id) with check ((select auth.uid()) = customer_id);
create policy "tasks owner delete" on public.tasks for delete to authenticated
using ((select auth.uid()) = customer_id);

drop policy if exists "responses participants" on public.responses;
drop policy if exists "responses helper insert" on public.responses;
drop policy if exists "responses customer update" on public.responses;
create policy "responses participants" on public.responses for select to authenticated
using (
  (select auth.uid()) = helper_id
  or exists (
    select 1 from public.tasks t
    where t.id = task_id and t.customer_id = (select auth.uid())
  )
);
create policy "responses helper insert" on public.responses for insert to authenticated
with check (
  (select auth.uid()) = helper_id
  and status = 'pending'
  and exists (
    select 1 from public.tasks t
    where t.id = task_id and t.status = 'open' and t.customer_id <> (select auth.uid())
  )
);
create policy "responses customer update" on public.responses for update to authenticated
using (exists (
  select 1 from public.tasks t
  where t.id = task_id and t.customer_id = (select auth.uid())
))
with check (exists (
  select 1 from public.tasks t
  where t.id = task_id and t.customer_id = (select auth.uid())
));

drop policy if exists "conversations participants" on public.conversations;
drop policy if exists "conversations participants insert" on public.conversations;
create policy "conversations participants" on public.conversations for select to authenticated
using ((select auth.uid()) in (customer_id, helper_id));
create policy "conversations participants insert" on public.conversations for insert to authenticated
with check (
  (select auth.uid()) in (customer_id, helper_id)
  and exists (
    select 1 from public.tasks t
    where t.id = task_id and t.customer_id = customer_id
  )
  and exists (
    select 1 from public.responses r
    where r.task_id = task_id and r.helper_id = helper_id and r.status = 'accepted'
  )
);

drop policy if exists "messages participants" on public.messages;
drop policy if exists "messages sender insert" on public.messages;
drop policy if exists "messages recipient update" on public.messages;
create policy "messages participants" on public.messages for select to authenticated
using (exists (
  select 1 from public.conversations c
  where c.id = conversation_id and (select auth.uid()) in (c.customer_id, c.helper_id)
));
create policy "messages sender insert" on public.messages for insert to authenticated
with check (
  (select auth.uid()) = sender_id
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and (select auth.uid()) in (c.customer_id, c.helper_id)
  )
);
create policy "messages recipient update" on public.messages for update to authenticated
using (
  sender_id <> (select auth.uid())
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and (select auth.uid()) in (c.customer_id, c.helper_id)
  )
)
with check (
  sender_id <> (select auth.uid())
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and (select auth.uid()) in (c.customer_id, c.helper_id)
  )
);

drop policy if exists "favorites self" on public.favorites;
create policy "favorites self" on public.favorites for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "reports self insert" on public.reports;
create policy "reports self insert" on public.reports for insert to authenticated
with check ((select auth.uid()) = reporter_id);

drop policy if exists "subscriptions self read" on public.subscriptions;
create policy "subscriptions self read" on public.subscriptions for select to authenticated
using ((select auth.uid()) = user_id);

create index if not exists services_owner_id_idx on public.services (owner_id);
create index if not exists tasks_customer_id_idx on public.tasks (customer_id);
create index if not exists responses_task_id_idx on public.responses (task_id);
create index if not exists responses_helper_id_idx on public.responses (helper_id);
create index if not exists conversations_customer_id_idx on public.conversations (customer_id);
create index if not exists conversations_helper_id_idx on public.conversations (helper_id);
create index if not exists messages_conversation_id_idx on public.messages (conversation_id);
create index if not exists reports_reporter_id_idx on public.reports (reporter_id);
create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);

commit;
