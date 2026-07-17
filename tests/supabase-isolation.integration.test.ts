import { describe,expect,it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const configured=Boolean(process.env.TEST_SUPABASE_URL&&process.env.TEST_SUPABASE_ANON_KEY&&process.env.TEST_USER_A_EMAIL&&process.env.TEST_USER_A_PASSWORD&&process.env.TEST_PROJECT_A_ID&&process.env.TEST_PROJECT_B_ID);
const suite=describe.skipIf(!configured);

/**
 * Opt-in integration coverage. Point these variables at a disposable Supabase
 * project with two seeded agencies/clients/projects and two test users. The
 * fixture is intentionally never the production database.
 */
suite("Supabase tenant isolation",()=>{
  it("denies user A access to user B's project through RLS",async()=>{
    const client=createClient(process.env.TEST_SUPABASE_URL!,process.env.TEST_SUPABASE_ANON_KEY!);
    const signIn=await client.auth.signInWithPassword({email:process.env.TEST_USER_A_EMAIL!,password:process.env.TEST_USER_A_PASSWORD!});
    expect(signIn.error).toBeNull();
    const result=await client.from("seo_projects").select("id").eq("id",process.env.TEST_PROJECT_B_ID!).maybeSingle();
    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
  });
  it("can read its own seeded project and proves the API fixture is usable",async()=>{
    const client=createClient(process.env.TEST_SUPABASE_URL!,process.env.TEST_SUPABASE_ANON_KEY!);
    const signIn=await client.auth.signInWithPassword({email:process.env.TEST_USER_A_EMAIL!,password:process.env.TEST_USER_A_PASSWORD!});
    expect(signIn.error).toBeNull();
    const result=await client.from("seo_projects").select("id,agency_id,client_organization_id").eq("id",process.env.TEST_PROJECT_A_ID!).maybeSingle();
    expect(result.error).toBeNull();
    expect(result.data?.id).toBe(process.env.TEST_PROJECT_A_ID);
    expect(result.data?.agency_id).toBeTruthy();
    expect(result.data?.client_organization_id).toBeTruthy();
  });
});
