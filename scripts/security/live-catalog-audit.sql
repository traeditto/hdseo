do $$
declare missing text;browser_grants text;
begin
  select string_agg(format('%I.%I',n.nspname,c.relname),', ' order by c.relname) into missing
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity
    and c.relname not in ('spatial_ref_sys');
  if missing is not null then raise exception 'Tables without RLS: %',missing; end if;

  select string_agg(format('%I:%s:%s',table_name,grantee,privilege_type),', ') into browser_grants
  from information_schema.role_table_grants
  where table_schema='public' and grantee in ('anon','authenticated')
    and table_name in ('integration_oauth_states','background_jobs','queue_outbox','queue_delivery_attempts','api_idempotency_records','provider_rate_buckets','security_events','audit_ledger','break_glass_events')
    and privilege_type<>'SELECT';
  if browser_grants is not null then raise exception 'Unsafe browser grants: %',browser_grants; end if;
end $$;

select relation_name,rls_enabled,force_rls,policy_count from public.security_posture_catalog order by relation_name;
