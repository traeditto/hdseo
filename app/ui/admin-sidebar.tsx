import Link from "next/link";

type User={displayName:string;email:string};

export function AdminSidebar({user,active}:{user:User;active:"overview"|"github"|"system"}){
  return <aside className="live-sidebar admin-sidebar">
    <Link className="role-brand" href="/"><span className="login-mark"><i/><b/></span><span>HD <em>SEO</em></span></Link>
    <div className="live-workspace"><small>PLATFORM</small><strong>HD SEO Administration</strong><span>Enterprise control plane</span></div>
    <nav aria-label="Admin navigation">
      <Link className={active==="overview"?"active":""} href="/portal/admin"><span>⌂</span>Platform overview</Link>
      <span className="admin-nav-label">SETTINGS</span>
      <Link className={active==="github"?"active":""} href="/portal/admin/settings/github"><span>⌘</span>GitHub</Link>
      <Link className={active==="system"?"active":""} href="/portal/admin/system"><span>◌</span>System readiness</Link>
    </nav>
    <div className="live-user"><strong>{user.displayName}</strong><span>{user.email}</span><a href="/api/auth/signout">Sign out</a></div>
  </aside>;
}
