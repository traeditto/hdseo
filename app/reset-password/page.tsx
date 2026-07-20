import { ResetPasswordForm } from "@/app/ui/reset-password-form";
import { isPortalRole } from "@/lib/auth/portal-types";

export default async function ResetPasswordPage({searchParams}:{searchParams:Promise<{portal?:string}>}){
  const params=await searchParams,portal=isPortalRole(params.portal)?params.portal:"client";
  return <ResetPasswordForm portal={portal}/>;
}
