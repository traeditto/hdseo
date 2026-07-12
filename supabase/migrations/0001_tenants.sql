create extension if not exists pgcrypto;

create type public.agency_role as enum ('agency_owner','agency_admin','seo_director','seo_strategist','content_editor','developer','account_manager','viewer');
create type public.member_status as enum ('invited','active','suspended');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'active' check (status in ('trial','active','past_due','suspended','closed')),
  plan text not null default 'founding',
  billing_email text,
  default_timezone text not null default 'UTC',
  default_country char(2) not null default 'US',
  default_language text not null default 'en',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.agency_members (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.agency_role not null,
  status public.member_status not null default 'invited',
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (agency_id, user_id)
);

create table public.client_organizations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  name text not null, slug text not null, industry text,
  status text not null default 'active' check (status in ('onboarding','active','paused','archived')),
  primary_contact_name text, primary_contact_email text, branding_enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (agency_id, slug), unique (agency_id, id)
);

create table public.client_members (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_organization_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('client_admin','client_approver','client_viewer')),
  status public.member_status not null default 'invited',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (client_organization_id, user_id),
  foreign key (agency_id, client_organization_id) references public.client_organizations(agency_id, id) on delete cascade
);

create table public.agency_branding (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null unique references public.agencies(id) on delete cascade,
  platform_name text not null default 'SEO Agency OS', logo_url text, favicon_url text,
  primary_color text not null default '#15755f', secondary_color text not null default '#192321', accent_color text not null default '#e7f3ee', sidebar_color text not null default '#192321',
  email_logo_url text, support_email text, support_phone text, custom_login_heading text, custom_login_subheading text,
  powered_by_visibility boolean not null default true, custom_domain_status text not null default 'none',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.agency_domains (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null references public.agencies(id) on delete cascade,
  hostname text not null unique, status text not null default 'pending' check (status in ('pending','verified','active','failed')),
  verification_token text not null default encode(gen_random_bytes(24), 'hex'), verified_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
