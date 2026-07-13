create table public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null default 'platform_admin' check (role in ('platform_owner','platform_admin','support_admin')),
  status public.member_status not null default 'invited',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
create policy platform_admin_self_read on public.platform_admins for select using (user_id = auth.uid());
revoke all on public.platform_admins from anon;
grant select on public.platform_admins to authenticated;

create index platform_admin_user_status on public.platform_admins(user_id,status);
