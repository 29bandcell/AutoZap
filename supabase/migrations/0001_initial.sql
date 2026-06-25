create extension if not exists pgcrypto;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  full_name text not null,
  role text not null default 'owner' check (role in ('owner','admin','reseller','agent')),
  created_at timestamptz not null default now()
);
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reseller_id uuid references public.profiles(id) on delete set null,
  name text not null,
  phone text not null,
  plan_name text not null,
  status text not null default 'active' check (status in ('trial','active','expired','suspended')),
  expires_at date not null,
  iptv_external_id text,
  iptv_username text,
  iptv_password_encrypted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.message_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  dedupe_key text not null unique,
  phone text not null,
  message text not null,
  status text not null check (status in ('processing','sent','failed')),
  provider_response jsonb,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.renewals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  external_payment_id text unique,
  amount numeric(12,2) not null check (amount >= 0),
  period_days integer not null check (period_days > 0),
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index clients_tenant_expires_idx on public.clients(tenant_id, expires_at, status);
create index messages_tenant_created_idx on public.message_events(tenant_id, created_at desc);
create index renewals_tenant_status_idx on public.renewals(tenant_id, status);

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.message_events enable row level security;
alter table public.renewals enable row level security;

create function public.current_tenant_id() returns uuid language sql stable security invoker set search_path = '' as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;
create policy "tenant members read tenant" on public.tenants for select to authenticated using (id = public.current_tenant_id());
create policy "members read profiles" on public.profiles for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "members manage clients" on public.clients for all to authenticated using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy "members read messages" on public.message_events for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "members manage renewals" on public.renewals for all to authenticated using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());

grant usage on schema public to authenticated;
grant select on public.tenants, public.profiles, public.message_events to authenticated;
grant select, insert, update, delete on public.clients, public.renewals to authenticated;
