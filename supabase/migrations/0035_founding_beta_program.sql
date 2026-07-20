-- Capacity-controlled Founding Beta enrollment and auditable introductory
-- billing. Beta discounts apply to the first monthly invoice only; normal
-- subscription entitlements and cost ceilings remain unchanged.

alter table public.client_subscriptions
  add column if not exists offer_key text,
  add column if not exists offer_price_cents integer check(offer_price_cents is null or offer_price_cents >= 0),
  add column if not exists offer_started_at timestamptz,
  add column if not exists offer_ends_at timestamptz,
  add column if not exists beta_redeemed_at timestamptz;

alter table public.agency_subscriptions
  add column if not exists offer_key text,
  add column if not exists offer_price_cents integer check(offer_price_cents is null or offer_price_cents >= 0),
  add column if not exists offer_started_at timestamptz,
  add column if not exists offer_ends_at timestamptz,
  add column if not exists beta_redeemed_at timestamptz;

create table public.beta_offer_enrollments (
  id uuid primary key default gen_random_uuid(),
  offer_key text not null,
  audience text not null check(audience in ('business','agency')),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_organization_id uuid,
  project_id uuid,
  plan_key text not null,
  status text not null default 'reserved'
    check(status in ('reserved','active','expired','released','canceled')),
  price_cents integer not null check(price_cents > 0),
  standard_price_cents integer not null check(standard_price_cents > price_cents),
  max_all_in_cost_cents integer not null check(max_all_in_cost_cents >= 0 and max_all_in_cost_cents < price_cents),
  included_founder_minutes integer not null default 0 check(included_founder_minutes >= 0),
  duration_days integer not null check(duration_days between 1 and 90),
  stripe_checkout_session_id text,
  stripe_customer_id text,
  stripe_subscription_id text,
  reserved_at timestamptz not null default now(),
  reservation_expires_at timestamptz not null default (now()+interval '30 minutes'),
  activated_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(
    (audience='business' and project_id is not null and client_organization_id is not null)
    or (audience='agency' and project_id is null and client_organization_id is null)
  ),
  unique(project_id,offer_key)
);

create unique index beta_offer_agency_once_unique
  on public.beta_offer_enrollments(agency_id,offer_key)
  where audience='agency';
create unique index beta_offer_checkout_session_unique
  on public.beta_offer_enrollments(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create index beta_offer_capacity_idx
  on public.beta_offer_enrollments(offer_key,audience,plan_key,status,reservation_expires_at);

alter table public.beta_offer_enrollments enable row level security;
create policy beta_offer_client_read on public.beta_offer_enrollments
  for select to authenticated
  using(client_organization_id is not null and public.has_client_access(agency_id,client_organization_id));
create policy beta_offer_agency_read on public.beta_offer_enrollments
  for select to authenticated using(public.is_agency_member(agency_id));

create or replace function public.reserve_beta_offer(
  p_offer_key text,
  p_audience text,
  p_agency_id uuid,
  p_client_organization_id uuid,
  p_project_id uuid,
  p_plan_key text,
  p_price_cents integer,
  p_standard_price_cents integer,
  p_max_all_in_cost_cents integer,
  p_included_founder_minutes integer,
  p_capacity integer,
  p_duration_days integer
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_existing public.beta_offer_enrollments;
  v_active_count integer;
begin
  if p_audience not in ('business','agency') or p_capacity < 1 or
     p_price_cents <= 0 or p_standard_price_cents <= p_price_cents or
     p_max_all_in_cost_cents >= p_price_cents then
    raise exception 'BETA_CONFIGURATION_INVALID';
  end if;
  if (p_audience='business' and (p_project_id is null or p_client_organization_id is null)) or
     (p_audience='agency' and (p_project_id is not null or p_client_organization_id is not null)) then
    raise exception 'BETA_TENANT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_offer_key||':'||p_audience||':'||p_plan_key,0));
  update public.beta_offer_enrollments set status='expired',updated_at=now()
    where offer_key=p_offer_key and audience=p_audience and plan_key=p_plan_key
      and status='reserved' and reservation_expires_at<=now();

  select * into v_existing from public.beta_offer_enrollments
    where offer_key=p_offer_key and audience=p_audience and agency_id=p_agency_id
      and ((p_audience='business' and project_id=p_project_id) or p_audience='agency')
    limit 1 for update;

  if v_existing.status='active' then
    return jsonb_build_object('allowed',false,'reason','BETA_ALREADY_REDEEMED','reservationId',v_existing.id);
  end if;
  if v_existing.status='reserved' and v_existing.reservation_expires_at>now() then
    return jsonb_build_object('allowed',true,'reused',true,'reservationId',v_existing.id);
  end if;

  select count(*)::integer into v_active_count from public.beta_offer_enrollments
    where offer_key=p_offer_key and audience=p_audience and plan_key=p_plan_key
      and (status='active' or (status='reserved' and reservation_expires_at>now()));
  if v_active_count>=p_capacity then
    return jsonb_build_object('allowed',false,'reason','BETA_TIER_FULL','remaining',0);
  end if;

  if v_existing.id is not null then
    update public.beta_offer_enrollments set
      plan_key=p_plan_key,status='reserved',price_cents=p_price_cents,
      standard_price_cents=p_standard_price_cents,max_all_in_cost_cents=p_max_all_in_cost_cents,
      included_founder_minutes=p_included_founder_minutes,duration_days=p_duration_days,
      stripe_checkout_session_id=null,stripe_customer_id=null,stripe_subscription_id=null,
      reserved_at=now(),reservation_expires_at=now()+interval '30 minutes',
      activated_at=null,ends_at=null,updated_at=now()
      where id=v_existing.id returning * into v_existing;
  else
    insert into public.beta_offer_enrollments(
      offer_key,audience,agency_id,client_organization_id,project_id,plan_key,
      price_cents,standard_price_cents,max_all_in_cost_cents,included_founder_minutes,duration_days
    ) values(
      p_offer_key,p_audience,p_agency_id,p_client_organization_id,p_project_id,p_plan_key,
      p_price_cents,p_standard_price_cents,p_max_all_in_cost_cents,p_included_founder_minutes,p_duration_days
    ) returning * into v_existing;
  end if;

  return jsonb_build_object('allowed',true,'reused',false,'reservationId',v_existing.id,
    'remaining',greatest(0,p_capacity-v_active_count-1));
end $$;

create or replace function public.attach_beta_checkout(
  p_reservation_id uuid,
  p_checkout_session_id text
) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.beta_offer_enrollments set
    stripe_checkout_session_id=p_checkout_session_id,updated_at=now()
    where id=p_reservation_id and status='reserved' and reservation_expires_at>now();
  if not found then raise exception 'BETA_RESERVATION_INVALID'; end if;
end $$;

create or replace function public.release_beta_offer(
  p_reservation_id uuid
) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.beta_offer_enrollments set status='released',updated_at=now()
    where id=p_reservation_id and status='reserved';
end $$;

create or replace function public.activate_beta_offer(
  p_reservation_id uuid,
  p_checkout_session_id text,
  p_customer_id text,
  p_subscription_id text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_enrollment public.beta_offer_enrollments;
begin
  select * into v_enrollment from public.beta_offer_enrollments
    where id=p_reservation_id and stripe_checkout_session_id=p_checkout_session_id
    for update;
  if v_enrollment.id is null then raise exception 'BETA_RESERVATION_INVALID'; end if;
  if v_enrollment.status='active' then
    return jsonb_build_object('activated',true,'duplicate',true,'endsAt',v_enrollment.ends_at);
  end if;
  if v_enrollment.status<>'reserved' then raise exception 'BETA_RESERVATION_INVALID'; end if;

  update public.beta_offer_enrollments set
    status='active',stripe_customer_id=p_customer_id,stripe_subscription_id=p_subscription_id,
    activated_at=now(),ends_at=now()+make_interval(days=>duration_days),updated_at=now()
    where id=v_enrollment.id returning * into v_enrollment;
  return jsonb_build_object('activated',true,'duplicate',false,'endsAt',v_enrollment.ends_at);
end $$;

revoke all on function public.reserve_beta_offer(text,text,uuid,uuid,uuid,text,integer,integer,integer,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.attach_beta_checkout(uuid,text) from public,anon,authenticated;
revoke all on function public.release_beta_offer(uuid) from public,anon,authenticated;
revoke all on function public.activate_beta_offer(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_beta_offer(text,text,uuid,uuid,uuid,text,integer,integer,integer,integer,integer,integer) to service_role;
grant execute on function public.attach_beta_checkout(uuid,text) to service_role;
grant execute on function public.release_beta_offer(uuid) to service_role;
grant execute on function public.activate_beta_offer(uuid,text,text,text) to service_role;
