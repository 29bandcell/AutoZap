-- AutoZap SaaS layer: 3-day trial, tenant subscription status and IPTV provider/test URLs.
-- This keeps every buyer/customer isolated by tenant_id.

alter table public.tenants
  alter column trial_ends_at set default (now() + interval '3 days');

update public.tenants
set trial_ends_at = least(coalesce(trial_ends_at, now() + interval '3 days'), created_at + interval '3 days')
where status = 'trial';

create table if not exists public.tenant_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_code text not null default 'starter',
  status text not null default 'trial' check (status in ('trial','active','past_due','suspended','cancelled')),
  trial_started_at timestamptz not null default now(),
  trial_ends_at timestamptz not null default (now() + interval '3 days'),
  current_period_started_at timestamptz,
  current_period_ends_at timestamptz,
  provider text,
  external_subscription_id text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);

insert into public.tenant_subscriptions (tenant_id, plan_code, status, trial_started_at, trial_ends_at, created_at, updated_at)
select id, plan_code, status, created_at, coalesce(trial_ends_at, created_at + interval '3 days'), created_at, updated_at
from public.tenants
on conflict (tenant_id) do nothing;

create table if not exists public.iptv_integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null default '',
  mode text not null default 'links' check (mode in ('links','api')),
  api_base_url text,
  auth_type text not null default 'none' check (auth_type in ('none','bearer','apikey','basic')),
  secret_ref text,
  notes text,
  status text not null default 'active' check (status in ('active','paused','error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);

create table if not exists public.iptv_test_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  integration_id uuid references public.iptv_integrations(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  package_name text not null,
  keyword text not null,
  method text not null default 'POST' check (method in ('GET','POST')),
  url text not null,
  status text not null default 'active' check (status in ('active','paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, keyword)
);

create index if not exists tenant_subscriptions_status_idx on public.tenant_subscriptions(status, trial_ends_at);
create index if not exists iptv_integrations_tenant_idx on public.iptv_integrations(tenant_id);
create index if not exists iptv_test_packages_tenant_idx on public.iptv_test_packages(tenant_id, status);
create index if not exists iptv_test_packages_keyword_idx on public.iptv_test_packages(tenant_id, lower(keyword)) where status = 'active';

alter table public.tenant_subscriptions enable row level security;
alter table public.iptv_integrations enable row level security;
alter table public.iptv_test_packages enable row level security;

alter table public.tenant_subscriptions force row level security;
alter table public.iptv_integrations force row level security;
alter table public.iptv_test_packages force row level security;

create policy tenant_subscriptions_select on public.tenant_subscriptions
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy iptv_integrations_tenant_all on public.iptv_integrations
  for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));

create policy iptv_test_packages_tenant_all on public.iptv_test_packages
  for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));

revoke all on public.tenant_subscriptions, public.iptv_integrations, public.iptv_test_packages from anon;
grant select on public.tenant_subscriptions to authenticated;
grant select, insert, update, delete on public.iptv_integrations, public.iptv_test_packages to authenticated;
