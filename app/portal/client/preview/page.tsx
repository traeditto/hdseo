import { PortalDashboard } from "@/app/ui/portal-dashboard";
export default function ClientPreview(){return <PortalDashboard portal="client" demo identity={{userId:"demo",email:"client@kingdom.demo",displayName:"James Carter",organization:"Kingdom Roofing",role:"client_approver",destination:"/portal/client"}}/>;}
