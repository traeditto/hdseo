import { integer,sqliteTable,text,uniqueIndex,index } from "drizzle-orm/sqlite-core";

export const liveUsers=sqliteTable("live_users",{
  email:text("email").primaryKey(),displayName:text("display_name").notNull(),platformRole:text("platform_role"),createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull()
});
export const liveAgencies=sqliteTable("live_agencies",{
  id:text("id").primaryKey(),name:text("name").notNull(),slug:text("slug").notNull(),ownerEmail:text("owner_email").notNull().references(()=>liveUsers.email),createdAt:text("created_at").notNull()
},table=>[uniqueIndex("live_agencies_slug").on(table.slug)]);
export const liveAgencyMembers=sqliteTable("live_agency_members",{
  id:text("id").primaryKey(),agencyId:text("agency_id").notNull().references(()=>liveAgencies.id,{onDelete:"cascade"}),userEmail:text("user_email").notNull().references(()=>liveUsers.email,{onDelete:"cascade"}),role:text("role").notNull(),createdAt:text("created_at").notNull()
},table=>[uniqueIndex("live_agency_member_unique").on(table.agencyId,table.userEmail),index("live_agency_member_email").on(table.userEmail)]);
export const liveClients=sqliteTable("live_clients",{
  id:text("id").primaryKey(),agencyId:text("agency_id").notNull().references(()=>liveAgencies.id,{onDelete:"cascade"}),name:text("name").notNull(),domain:text("domain").notNull(),contactEmail:text("contact_email"),status:text("status").notNull().default("active"),createdAt:text("created_at").notNull()
},table=>[index("live_clients_agency").on(table.agencyId)]);
export const liveClientMembers=sqliteTable("live_client_members",{
  id:text("id").primaryKey(),clientId:text("client_id").notNull().references(()=>liveClients.id,{onDelete:"cascade"}),userEmail:text("user_email").notNull().references(()=>liveUsers.email,{onDelete:"cascade"}),role:text("role").notNull(),createdAt:text("created_at").notNull()
},table=>[uniqueIndex("live_client_member_unique").on(table.clientId,table.userEmail)]);
export const liveProjects=sqliteTable("live_projects",{
  id:text("id").primaryKey(),agencyId:text("agency_id").notNull().references(()=>liveAgencies.id,{onDelete:"cascade"}),clientId:text("client_id").notNull().references(()=>liveClients.id,{onDelete:"cascade"}),name:text("name").notNull(),domain:text("domain").notNull(),status:text("status").notNull().default("active"),createdAt:text("created_at").notNull()
},table=>[index("live_projects_agency").on(table.agencyId),index("live_projects_client").on(table.clientId)]);
export const liveOpportunities=sqliteTable("live_opportunities",{
  id:text("id").primaryKey(),agencyId:text("agency_id").notNull().references(()=>liveAgencies.id,{onDelete:"cascade"}),projectId:text("project_id").notNull().references(()=>liveProjects.id,{onDelete:"cascade"}),keyword:text("keyword").notNull(),currentRank:integer("current_rank"),targetRank:integer("target_rank").notNull().default(10),score:integer("score").notNull(),actionType:text("action_type").notNull(),reason:text("reason").notNull(),status:text("status").notNull().default("open"),createdAt:text("created_at").notNull()
},table=>[index("live_opportunities_project").on(table.projectId),index("live_opportunities_agency").on(table.agencyId)]);
export const liveTasks=sqliteTable("live_tasks",{
  id:text("id").primaryKey(),agencyId:text("agency_id").notNull().references(()=>liveAgencies.id,{onDelete:"cascade"}),projectId:text("project_id").notNull().references(()=>liveProjects.id,{onDelete:"cascade"}),opportunityId:text("opportunity_id").references(()=>liveOpportunities.id,{onDelete:"set null"}),title:text("title").notNull(),status:text("status").notNull().default("ready"),priority:text("priority").notNull().default("medium"),assignedEmail:text("assigned_email"),implementationPath:text("implementation_path"),createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull()
},table=>[index("live_tasks_agency").on(table.agencyId),index("live_tasks_project").on(table.projectId)]);
export const livePackages=sqliteTable("live_packages",{
  id:text("id").primaryKey(),agencyId:text("agency_id").notNull().references(()=>liveAgencies.id,{onDelete:"cascade"}),projectId:text("project_id").notNull().references(()=>liveProjects.id,{onDelete:"cascade"}),opportunityId:text("opportunity_id").notNull().references(()=>liveOpportunities.id,{onDelete:"cascade"}),title:text("title").notNull(),implementationPath:text("implementation_path").notNull(),status:text("status").notNull().default("agency_review"),packageData:text("package_data").notNull(),createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull()
},table=>[index("live_packages_agency").on(table.agencyId),index("live_packages_project").on(table.projectId)]);
export const liveEvents=sqliteTable("live_events",{
  id:text("id").primaryKey(),agencyId:text("agency_id").notNull().references(()=>liveAgencies.id,{onDelete:"cascade"}),projectId:text("project_id").references(()=>liveProjects.id,{onDelete:"cascade"}),eventType:text("event_type").notNull(),title:text("title").notNull(),description:text("description"),actorEmail:text("actor_email").notNull(),clientVisible:integer("client_visible",{mode:"boolean"}).notNull().default(false),createdAt:text("created_at").notNull()
},table=>[index("live_events_agency").on(table.agencyId),index("live_events_project").on(table.projectId)]);
