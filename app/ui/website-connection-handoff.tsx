"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import styles from "@/app/ui/website-connection-handoff.module.css";

type Invite = {
  id: string;
  projectName: string;
  domain: string;
  platform: string;
  status: string;
  allowedMethods: string[];
  expiresAt: string;
  firstOpenedAt: string | null;
  completedAt: string | null;
  needsRepositorySelection: boolean;
  repositories: Array<{ id: number; fullName: string; defaultBranch: string }>;
};

type Method = "wordpress" | "shopify" | "webflow" | "github";

const methodCopy: Record<Method, { title: string; detail: string }> = {
  wordpress: { title: "WordPress", detail: "Use an editor username and an Application Password." },
  shopify: { title: "Shopify", detail: "Use a store Admin API access token." },
  webflow: { title: "Webflow", detail: "Use the site ID and a scoped API token." },
  github: { title: "GitHub / Vercel", detail: "Authorize only the repository that deploys this website." },
};

function recommended(platform: string): Method {
  if (["wordpress", "shopify", "webflow"].includes(platform)) return platform as Method;
  return "github";
}

export function WebsiteConnectionHandoff({ token }: { token: string }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [method, setMethod] = useState<Method>("github");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const apiPath = useMemo(() => `/api/website-connection-invites/${encodeURIComponent(token)}`, [token]);

  useEffect(() => {
    let active = true;
    fetch(apiPath, { cache: "no-store", referrerPolicy: "no-referrer" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "This setup link could not be opened.");
        return payload.invite as Invite;
      })
      .then((value) => {
        if (!active) return;
        setInvite(value);
        setMethod(recommended(value.platform));
      })
      .catch((error) => active && setMessage(error instanceof Error ? error.message : "This setup link could not be opened."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [apiPath]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData(event.currentTarget);
      const body: Record<string, unknown> = { mode: method, siteUrl: String(form.get("siteUrl") ?? `https://${invite?.domain ?? ""}`) };
      if (method === "wordpress") Object.assign(body, { username: form.get("username"), applicationPassword: form.get("applicationPassword") });
      if (method === "shopify") Object.assign(body, { accessToken: form.get("accessToken") });
      if (method === "webflow") Object.assign(body, { siteId: form.get("siteId"), accessToken: form.get("accessToken") });
      const response = await fetch(apiPath, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), referrerPolicy: "no-referrer" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "The website connection could not be verified.");
      setInvite((current) => current ? { ...current, status: "completed", completedAt: payload.result?.completedAt ?? new Date().toISOString() } : current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The website connection could not be verified.");
    } finally {
      setBusy(false);
    }
  }

  async function selectRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const repositoryId = Number(new FormData(event.currentTarget).get("repositoryId"));
      const response = await fetch(`${apiPath}/repository`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repositoryId }), referrerPolicy: "no-referrer" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "The repository could not be connected.");
      setInvite((current) => current ? { ...current, status: "completed", completedAt: new Date().toISOString(), needsRepositorySelection: false } : current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The repository could not be connected.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className={styles.page}><div className={styles.shell}><div className={styles.loading}>Verifying the secure website setup link…</div></div></main>;
  if (!invite) return <main className={styles.page}><div className={styles.shell}><Link className={styles.brand} href="/"><span className={styles.mark}/>HD SEO</Link><section className={`${styles.card} ${styles.body}`}><div className={`${styles.notice} ${styles.error}`}>{message || "This setup link is unavailable."}</div></section></div></main>;
  if (invite.status === "completed") return <main className={styles.page}><div className={styles.shell}><Link className={styles.brand} href="/"><span className={styles.mark}/>HD SEO</Link><section className={styles.card}><div className={styles.success}><i>✓</i><h2>{invite.domain} is connected</h2><p>HD SEO has notified the business owner. You can close this page—no client account or additional access was created.</p></div></section></div></main>;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.brand} href="/"><span className={styles.mark}/>HD SEO</Link>
        <section className={styles.card}>
          <header className={styles.header}>
            <span className={styles.eyebrow}>SECURE WEBSITE HANDOFF</span>
            <h1>Connect {invite.domain}</h1>
            <p>The business owner asked you to provide the website access HD SEO needs to prepare approved SEO changes safely.</p>
            <div className={styles.scope}><span>Only this website</span><span>Expires in seven days</span><span>No billing or client data</span><span>No changes publish now</span></div>
          </header>
          <div className={styles.body}>
            <div className={styles.notice}>Credentials are verified server-side, encrypted before storage, and never displayed back to the business owner. This link cannot access rankings, leads, approvals, billing, or other client websites.</div>
            {message && <div className={`${styles.notice} ${styles.error}`} role="alert">{message}</div>}

            {invite.needsRepositorySelection ? (
              <form className={styles.repoList} onSubmit={selectRepository}>
                <h2>Which repository publishes {invite.domain}?</h2>
                <p>GitHub access is verified. Choose only the repository that contains this website.</p>
                <label>Website repository<select name="repositoryId" required defaultValue=""><option value="" disabled>Select a repository</option>{invite.repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.fullName}</option>)}</select></label>
                <button className={styles.primary} disabled={busy}>{busy ? "Verifying repository…" : "Connect this repository →"}</button>
              </form>
            ) : (
              <>
                <div className={styles.options}>
                  {(Object.keys(methodCopy) as Method[]).filter((item) => invite.allowedMethods.includes(item)).map((item) => (
                    <button className={`${styles.option} ${method === item ? styles.active : ""}`} type="button" onClick={() => setMethod(item)} key={item}>
                      <strong>{methodCopy[item].title}{recommended(invite.platform) === item && <span className={styles.recommended}>RECOMMENDED</span>}</strong>
                      <span>{methodCopy[item].detail}</span>
                    </button>
                  ))}
                </div>
                {method === "github" ? (
                  <div className={styles.github}><div><strong>Authorize the website repository</strong><span>GitHub will show the HD SEO App and let you select only the repository that deploys {invite.domain}.</span></div><a href={`${apiPath}/github`} referrerPolicy="no-referrer">Continue to GitHub →</a></div>
                ) : (
                  <form className={styles.form} onSubmit={connect}>
                    <h2>Verify {methodCopy[method].title} access</h2>
                    <p>This verification does not publish or alter the website.</p>
                    <div className={styles.fields}>
                      <label>Website address<input name="siteUrl" type="url" required defaultValue={`https://${invite.domain}`} /></label>
                      {method === "wordpress" && <><label>WordPress username<input name="username" autoComplete="username" required /></label><label>Application Password<input name="applicationPassword" type="password" autoComplete="new-password" required /><small>Use Users → Profile → Application Passwords. Never enter the normal account password.</small></label></>}
                      {method === "shopify" && <label>Shopify Admin API token<input name="accessToken" type="password" autoComplete="new-password" placeholder="shpat_…" required /></label>}
                      {method === "webflow" && <><label>Webflow site ID<input name="siteId" required /></label><label>Webflow API token<input name="accessToken" type="password" autoComplete="new-password" required /></label></>}
                    </div>
                    <button className={styles.primary} disabled={busy}>{busy ? "Verifying securely…" : `Verify and connect ${methodCopy[method].title} →`}</button>
                  </form>
                )}
              </>
            )}
            <small className={styles.fine}>The owner remains responsible for approving changes. HD SEO keeps preview, validation, audit, and rollback safeguards enabled.</small>
          </div>
          <footer className={styles.footer}>Need help? Ask the business owner who sent this link or contact <a href="mailto:info@hdprecision.ai">HD SEO support</a>.</footer>
        </section>
      </div>
    </main>
  );
}
