declare const Deno:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Response|Promise<Response>):void};
const appUrl="https://hdseo.vercel.app";
Deno.serve(async(request:Request)=>{
  if(request.method!=="POST")return new Response("Method not allowed",{status:405});
  const workerSecret=Deno.env.get("AUTOMATION_WORKER_SECRET"),cronSecret=Deno.env.get("HD_SEO_CRON_SECRET");
  if(!workerSecret||!cronSecret)return Response.json({ok:false,error:"worker_not_configured"},{status:503});
  if(request.headers.get("authorization")!==`Bearer ${workerSecret}`)return Response.json({ok:false,error:"unauthorized"},{status:401});
  const response=await fetch(`${appUrl}/api/cron/automation`,{headers:{authorization:`Bearer ${cronSecret}`,"user-agent":"HDSEO-Supabase-Worker/1.0"}});
  return new Response(await response.text(),{status:response.status,headers:{"content-type":response.headers.get("content-type")??"application/json","cache-control":"no-store"}});
});
