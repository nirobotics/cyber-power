create table public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  feishu_open_id text not null unique check (length(trim(feishu_open_id)) > 0),
  display_name text not null check (length(trim(display_name)) > 0),
  avatar_url text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

comment on table public.user_profiles is
  'Server-only Feishu identity mapping for Cyber Power authentication.';

alter table public.user_profiles enable row level security;
alter table public.user_profiles force row level security;

revoke all privileges on table public.user_profiles from public, anon, authenticated;
grant select, insert, update on table public.user_profiles to service_role;
