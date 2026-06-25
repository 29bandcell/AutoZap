
-- ============================================================
-- MIGRATION: outputs/iptv-revenda/supabase/migrations/0001_initial.sql
-- ============================================================
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



-- ============================================================
-- MIGRATION: outputs/iptv-revenda/supabase/migrations/20260623192100_automation_engine.sql
-- ============================================================
-- Production automation engine schema for AutoZap.
-- Multi-tenant isolation is enforced in Postgres, not only in application code.

create schema if not exists private;
revoke all on schema private from public, anon;

drop function if exists public.current_tenant_id() cascade;

create or replace function private.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.tenant_id
  from public.profiles p
  where p.id = (select auth.uid())
  limit 1
$$;

revoke all on function private.current_tenant_id() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.current_tenant_id() to authenticated;

alter table public.tenants
  add column if not exists slug text,
  add column if not exists status text not null default 'trial',
  add column if not exists plan_code text not null default 'starter',
  add column if not exists trial_ends_at timestamptz default (now() + interval '14 days'),
  add column if not exists max_devices integer not null default 1,
  add column if not exists max_apps integer not null default 1,
  add column if not exists monthly_message_limit integer not null default 1000,
  add column if not exists updated_at timestamptz not null default now();

update public.tenants set slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || left(id::text, 8) where slug is null;
alter table public.tenants alter column slug set not null;
alter table public.tenants add constraint tenants_status_check check (status in ('trial','active','past_due','suspended','cancelled')) not valid;
alter table public.tenants validate constraint tenants_status_check;
create unique index if not exists tenants_slug_key on public.tenants(slug);
create unique index if not exists tenants_owner_id_key on public.tenants(owner_id);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  provider text not null default 'evolution' check (provider in ('evolution','meta_cloud')),
  instance_name text not null,
  phone text,
  status text not null default 'connecting' check (status in ('connecting','open','close','offline','error')),
  chatbot_enabled boolean not null default true,
  transcription_enabled boolean not null default false,
  reject_calls_enabled boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, instance_name)
);

create table if not exists public.api_apps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete restrict,
  name text not null,
  app_key_prefix text not null,
  app_key_hash text not null,
  auth_key_hash text not null,
  status text not null default 'active' check (status in ('active','disabled','revoked')),
  allowed_origins text[] not null default '{}',
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  kind text not null default 'text' check (kind in ('text','media','api_response')),
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  name text not null,
  keyword text not null,
  match_type text not null default 'exact' check (match_type in ('exact','contains','starts_with','regex')),
  action jsonb not null default '{"type":"reply"}'::jsonb,
  reply_template text not null,
  enabled boolean not null default true,
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  phone text not null,
  display_name text,
  opted_out_at timestamptz,
  last_interaction_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, phone)
);

create table if not exists public.contact_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists public.contact_group_members (
  group_id uuid not null references public.contact_groups(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, contact_id)
);

create table if not exists public.api_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  api_app_id uuid not null references public.api_apps(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  route text not null,
  status text not null default 'processing' check (status in ('processing','completed','failed')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (api_app_id, idempotency_key)
);

alter table public.message_events
  add column if not exists device_id uuid references public.devices(id) on delete set null,
  add column if not exists api_app_id uuid references public.api_apps(id) on delete set null,
  add column if not exists external_request_id text,
  add column if not exists direction text not null default 'outbound',
  add column if not exists message_type text not null default 'text';

create unique index if not exists message_events_tenant_external_key
  on public.message_events(tenant_id, external_request_id)
  where external_request_id is not null;
create index if not exists profiles_tenant_id_idx on public.profiles(tenant_id);
create index if not exists devices_tenant_id_idx on public.devices(tenant_id);
create index if not exists devices_open_idx on public.devices(tenant_id, last_seen_at desc) where status = 'open';
create index if not exists api_apps_tenant_id_idx on public.api_apps(tenant_id);
create index if not exists api_apps_device_id_idx on public.api_apps(device_id);
create index if not exists automation_rules_device_idx on public.automation_rules(device_id, enabled, priority);
create index if not exists automation_rules_tenant_keyword_idx on public.automation_rules(tenant_id, lower(keyword)) where enabled;
create index if not exists contacts_tenant_last_idx on public.contacts(tenant_id, last_interaction_at desc);
create index if not exists contacts_device_id_idx on public.contacts(device_id);
create index if not exists contact_group_members_tenant_idx on public.contact_group_members(tenant_id);
create index if not exists contact_group_members_contact_idx on public.contact_group_members(contact_id);
create index if not exists api_requests_tenant_created_idx on public.api_requests(tenant_id, created_at desc);
create index if not exists api_requests_app_id_idx on public.api_requests(api_app_id);
create index if not exists message_events_device_created_idx on public.message_events(device_id, created_at desc);
create index if not exists message_events_app_id_idx on public.message_events(api_app_id);

alter table public.devices enable row level security;
alter table public.api_apps enable row level security;
alter table public.message_templates enable row level security;
alter table public.automation_rules enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_groups enable row level security;
alter table public.contact_group_members enable row level security;
alter table public.api_requests enable row level security;

alter table public.tenants force row level security;
alter table public.profiles force row level security;
alter table public.devices force row level security;
alter table public.api_apps force row level security;
alter table public.message_templates force row level security;
alter table public.automation_rules force row level security;
alter table public.contacts force row level security;
alter table public.contact_groups force row level security;
alter table public.contact_group_members force row level security;
alter table public.api_requests force row level security;
alter table public.message_events force row level security;

-- Rebuild policies dropped with the old recursive helper.
drop policy if exists "tenant members read tenant" on public.tenants;
drop policy if exists "members read profiles" on public.profiles;
drop policy if exists "members manage clients" on public.clients;
drop policy if exists "members read messages" on public.message_events;
drop policy if exists "members manage renewals" on public.renewals;

create policy tenant_select on public.tenants for select to authenticated using (id = (select private.current_tenant_id()));
create policy profile_select on public.profiles for select to authenticated using (tenant_id = (select private.current_tenant_id()));
create policy clients_tenant_all on public.clients for all to authenticated using (tenant_id = (select private.current_tenant_id())) with check (tenant_id = (select private.current_tenant_id()));
create policy renewals_tenant_all on public.renewals for all to authenticated using (tenant_id = (select private.current_tenant_id())) with check (tenant_id = (select private.current_tenant_id()));
create policy devices_tenant_select on public.devices for select to authenticated using (tenant_id = (select private.current_tenant_id()));
create policy devices_tenant_update on public.devices for update to authenticated using (tenant_id = (select private.current_tenant_id())) with check (tenant_id = (select private.current_tenant_id()));
create policy api_apps_tenant_select on public.api_apps for select to authenticated using (tenant_id = (select private.current_tenant_id()));
create policy templates_tenant_all on public.message_templates for all to authenticated using (tenant_id = (select private.current_tenant_id())) with check (tenant_id = (select private.current_tenant_id()));
create policy rules_tenant_all on public.automation_rules for all to authenticated using (tenant_id = (select private.current_tenant_id())) with check (tenant_id = (select private.current_tenant_id()));
create policy contacts_tenant_all on public.contacts for all to authenticated using (tenant_id = (select private.current_tenant_id())) with check (tenant_id = (select private.current_tenant_id()));
create policy groups_tenant_all on public.contact_groups for all to authenticated using (tenant_id = (select private.current_tenant_id())) with check (tenant_id = (select private.current_tenant_id()));
create policy group_members_tenant_all on public.contact_group_members for all to authenticated using (tenant_id = (select private.current_tenant_id())) with check (tenant_id = (select private.current_tenant_id()));
create policy api_requests_tenant_select on public.api_requests for select to authenticated using (tenant_id = (select private.current_tenant_id()));
create policy message_events_tenant_select on public.message_events for select to authenticated using (tenant_id = (select private.current_tenant_id()));

revoke all on public.devices, public.api_apps, public.message_templates, public.automation_rules, public.contacts, public.contact_groups, public.contact_group_members, public.api_requests from anon;
grant select, update on public.devices to authenticated;
grant select on public.api_apps, public.api_requests, public.message_events to authenticated;
grant select, insert, update, delete on public.message_templates, public.automation_rules, public.contacts, public.contact_groups, public.contact_group_members to authenticated;


create table if not exists public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  phone text not null,
  message text not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','cancelled')),
  attempt_count integer not null default 0,
  idempotency_key text not null,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (tenant_id, idempotency_key)
);
create index if not exists scheduled_messages_due_idx on public.scheduled_messages(scheduled_for) where status = 'pending';
create index if not exists scheduled_messages_tenant_idx on public.scheduled_messages(tenant_id, scheduled_for desc);
create index if not exists scheduled_messages_device_idx on public.scheduled_messages(device_id);
create index if not exists scheduled_messages_contact_idx on public.scheduled_messages(contact_id);
alter table public.scheduled_messages enable row level security;
alter table public.scheduled_messages force row level security;
create policy scheduled_messages_tenant_all on public.scheduled_messages for all to authenticated using (tenant_id = (select private.current_tenant_id())) with check (tenant_id = (select private.current_tenant_id()));
revoke all on public.scheduled_messages from anon;
grant select, insert, update, delete on public.scheduled_messages to authenticated;



-- ============================================================
-- MIGRATION: outputs/iptv-revenda/supabase/migrations/20260625130000_iptv_subscription_saas.sql
-- ============================================================
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


