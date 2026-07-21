-- Allow an authorized business owner to enqueue work for their own project.
-- Migration 0017 incorrectly required every requester to be an agency member,
-- but self-service retail workspaces intentionally provision client membership
-- only. The function remains service-role-only and validates the complete
-- agency/client/project relationship before creating work.

create or replace function public.enqueue_agent_work_item(
  p_agency_id uuid,p_client_id uuid,p_project_id uuid,p_work_type text,p_goal text,p_agent_key text,
  p_evidence jsonb,p_proposed_plan jsonb,p_authorized_tools text[],p_spending_limit numeric,p_risk_level text,
  p_required_approvals jsonb,p_priority int,p_idempotency_key text,p_requested_by uuid,p_source_type text default null,p_source_id text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_work_id uuid;v_job_id uuid;v_invalid_tool text;v_organization_id uuid;v_ceiling text;
begin
  select organization_id into v_organization_id
  from public.clients
  where id=p_client_id and agency_id=p_agency_id;
  if v_organization_id is null then raise exception 'CLIENT_NOT_FOUND'; end if;

  if not exists(
    select 1 from public.seo_projects
    where id=p_project_id and agency_id=p_agency_id
      and client_organization_id=v_organization_id
  ) then raise exception 'PROJECT_NOT_FOUND'; end if;

  select default_risk_ceiling into v_ceiling
  from public.agent_definitions
  where agent_key=p_agent_key and status='active' and agency_id is null;
  if v_ceiling is null then raise exception 'AGENT_NOT_FOUND'; end if;
  if array_position(array['low','medium','high','critical'],p_risk_level)>
     array_position(array['low','medium','high','critical'],v_ceiling)
  then raise exception 'AGENT_RISK_CEILING_EXCEEDED'; end if;

  if p_requested_by is not null and not (
    exists(
      select 1 from public.agency_members
      where agency_id=p_agency_id and user_id=p_requested_by and status='active'
    )
    or exists(
      select 1 from public.client_members
      where agency_id=p_agency_id
        and client_organization_id=v_organization_id
        and user_id=p_requested_by
        and status='active'
        and role in ('client_admin','client_approver')
    )
  ) then raise exception 'REQUESTER_NOT_AUTHORIZED'; end if;

  select tool into v_invalid_tool
  from unnest(coalesce(p_authorized_tools,'{}')) tool
  where not exists(
    select 1
    from public.agent_tool_grants g
    join public.agent_definitions d on d.id=g.agent_definition_id
    where d.agent_key=p_agent_key and d.agency_id is null
      and g.tool_key=tool and g.permission<>'denied'
  ) limit 1;
  if v_invalid_tool is not null then
    raise exception 'TOOL_NOT_AUTHORIZED:%',v_invalid_tool;
  end if;

  if exists(
    select 1
    from unnest(coalesce(p_authorized_tools,'{}')) tool
    join public.agent_tool_grants g on g.tool_key=tool and g.approval_required
    join public.agent_definitions d on d.id=g.agent_definition_id
      and d.agent_key=p_agent_key and d.agency_id is null
  ) and jsonb_array_length(coalesce(p_required_approvals,'[]'))=0
  then raise exception 'APPROVAL_REQUIRED'; end if;

  select id into v_work_id
  from public.agent_work_items
  where agency_id=p_agency_id and idempotency_key=p_idempotency_key;
  if v_work_id is not null then
    return jsonb_build_object('workItemId',v_work_id,'duplicate',true);
  end if;

  insert into public.agent_work_items(
    agency_id,client_id,project_id,work_type,goal,assigned_agent_key,status,
    priority,risk_level,evidence,proposed_plan,authorized_tools,spending_limit,
    required_approvals,source_type,source_id,idempotency_key,requested_by
  ) values(
    p_agency_id,p_client_id,p_project_id,p_work_type,p_goal,p_agent_key,'queued',
    greatest(0,least(p_priority,100)),p_risk_level,coalesce(p_evidence,'{}'),
    coalesce(p_proposed_plan,'{}'),coalesce(p_authorized_tools,'{}'),
    greatest(0,coalesce(p_spending_limit,0)),coalesce(p_required_approvals,'[]'),
    p_source_type,p_source_id,p_idempotency_key,p_requested_by
  ) returning id into v_work_id;

  insert into public.agent_work_steps(
    work_item_id,sequence,agent_key,step_type,title,status,input
  ) values(
    v_work_id,1,'supervisor','supervisor.plan',
    'Review evidence, budget, permissions, and risk','ready',
    jsonb_build_object('assignedAgent',p_agent_key)
  );

  insert into public.agent_activity_events(
    agency_id,client_id,project_id,work_item_id,agent_key,event_type,title,description
  ) values(
    p_agency_id,p_client_id,p_project_id,v_work_id,'supervisor',
    'work_item.created','Work assigned',p_goal
  );

  insert into public.background_jobs(
    queue,job_type,agency_id,client_organization_id,project_id,payload,status,
    priority,idempotency_key
  ) values(
    'agents','agent.supervise',p_agency_id,v_organization_id,p_project_id,
    jsonb_build_object('workItemId',v_work_id),'queued',
    greatest(0,least(p_priority,100)),'agent.supervise:'||v_work_id
  ) returning id into v_job_id;

  return jsonb_build_object(
    'workItemId',v_work_id,'backgroundJobId',v_job_id,'duplicate',false
  );
end $$;

revoke all on function public.enqueue_agent_work_item(
  uuid,uuid,uuid,text,text,text,jsonb,jsonb,text[],numeric,text,jsonb,int,text,uuid,text,text
) from public,anon,authenticated;

grant execute on function public.enqueue_agent_work_item(
  uuid,uuid,uuid,text,text,text,jsonb,jsonb,text[],numeric,text,jsonb,int,text,uuid,text,text
) to service_role;
