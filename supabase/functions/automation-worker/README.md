# HD SEO automation worker

This Edge Function is the secondary queue trigger for regions or Vercel plans where a one-minute cron is not appropriate. Configure `AUTOMATION_WORKER_SECRET` and `HD_SEO_CRON_SECRET`, deploy it without public JWT verification, and invoke it from Supabase Cron with `Authorization: Bearer <AUTOMATION_WORKER_SECRET>`. The function never receives provider credentials; it calls the authenticated HD SEO worker endpoint at `https://hdseo.vercel.app/api/cron/automation`.
