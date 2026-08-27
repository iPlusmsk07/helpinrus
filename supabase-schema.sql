-- ПОМОГАЙ: базовая схема Supabase.
-- После неё обязательно выполнить supabase-auth-migration.sql,
-- затем проверить и выполнить supabase-security-hardening.sql.
create extension if not exists "uuid-ossp";

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer','helper','admin')),
  name text not null default '' check (char_length(name) <= 120), city text default 'Москва' check (char_length(city) <= 120), avatar_url text,
  legal_status text default 'private' check (legal_status in ('private','self_employed','ip','company')), verified boolean default false,
  pro_until timestamptz, rating numeric(2,1) default 5.0 check (rating between 0 and 5),
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists services (
  id uuid primary key default uuid_generate_v4(), owner_id uuid not null references profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120), category text not null, description text not null check (char_length(description) between 10 and 4000), price_from numeric check (price_from >= 0),
  city text default 'Москва' check (char_length(city) <= 120), latitude double precision check (latitude between -90 and 90), longitude double precision check (longitude between -180 and 180),
  response_minutes int default 60 check (response_minutes between 1 and 10080), is_active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists tasks (
  id uuid primary key default uuid_generate_v4(), customer_id uuid not null references profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120), category text not null, description text not null check (char_length(description) between 10 and 4000), budget numeric check (budget >= 0),
  address text check (char_length(address) <= 200), latitude double precision check (latitude between -90 and 90), longitude double precision check (longitude between -180 and 180), scheduled_at timestamptz,
  status text default 'open' check (status in ('draft','open','assigned','done','cancelled')),
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists responses (
  id uuid primary key default uuid_generate_v4(), task_id uuid not null references tasks(id) on delete cascade,
  helper_id uuid not null references profiles(id) on delete cascade, price numeric check (price >= 0), message text check (char_length(message) <= 4000),
  status text default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz default now(), unique(task_id,helper_id)
);
create table if not exists conversations (
  id uuid primary key default uuid_generate_v4(), task_id uuid references tasks(id) on delete set null,
  customer_id uuid not null references profiles(id), helper_id uuid not null references profiles(id),
  created_at timestamptz default now(),
  unique(task_id,customer_id,helper_id),
  check (customer_id <> helper_id)
);
create table if not exists messages (
  id bigint generated always as identity primary key, conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id), body text not null check (char_length(body) between 1 and 4000), read_at timestamptz,
  created_at timestamptz default now()
);
create table if not exists favorites (
  user_id uuid references profiles(id) on delete cascade, service_id uuid references services(id) on delete cascade,
  created_at timestamptz default now(), primary key(user_id,service_id)
);
create table if not exists reports (
  id uuid primary key default uuid_generate_v4(), reporter_id uuid references profiles(id), target_user_id uuid references profiles(id),
  reason text not null check (char_length(reason) between 3 and 120), details text check (char_length(details) <= 4000), status text default 'new' check (status in ('new','reviewing','resolved','rejected')), created_at timestamptz default now()
);
create table if not exists subscriptions (
  id uuid primary key default uuid_generate_v4(), user_id uuid not null references profiles(id), provider text,
  provider_subscription_id text unique, status text default 'pending' check (status in ('pending','active','past_due','cancelled','expired')), current_period_end timestamptz,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
alter table services enable row level security;
alter table tasks enable row level security;
alter table responses enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table favorites enable row level security;
alter table reports enable row level security;
alter table subscriptions enable row level security;

create policy "profiles public read" on profiles for select using (true);
create policy "profiles self update" on profiles for update using (auth.uid()=id);
create policy "services public read" on services for select using (is_active=true or auth.uid()=owner_id);
create policy "services owner write" on services for all using (auth.uid()=owner_id) with check (auth.uid()=owner_id);
create policy "tasks public read" on tasks for select using (status='open' or auth.uid()=customer_id);
create policy "tasks owner write" on tasks for all using (auth.uid()=customer_id) with check (auth.uid()=customer_id);
create policy "responses participants" on responses for select using (auth.uid()=helper_id or exists(select 1 from tasks t where t.id=task_id and t.customer_id=auth.uid()));
create policy "responses helper insert" on responses for insert with check (auth.uid()=helper_id);
create policy "conversations participants" on conversations for select using (auth.uid() in (customer_id,helper_id));
create policy "conversations participants insert" on conversations for insert with check (auth.uid() in (customer_id,helper_id));
create policy "messages participants" on messages for select using (exists(select 1 from conversations c where c.id=conversation_id and auth.uid() in (c.customer_id,c.helper_id)));
create policy "messages sender insert" on messages for insert with check (auth.uid()=sender_id and exists(select 1 from conversations c where c.id=conversation_id and auth.uid() in (c.customer_id,c.helper_id)));
create policy "favorites self" on favorites for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "reports self insert" on reports for insert with check (auth.uid()=reporter_id);
create policy "subscriptions self read" on subscriptions for select using (auth.uid()=user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end
$$;
