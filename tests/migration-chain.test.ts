import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((filename) => /^\d{4}_.+\.sql$/.test(filename))
  .sort();

describe("Supabase migration chain", () => {
  it("has one migration for every sequential number", () => {
    const numbers = migrationFiles.map((filename) => Number(filename.slice(0, 4)));
    const expected = Array.from({ length: numbers.at(-1) ?? 0 }, (_, index) => index + 1);

    expect(numbers).toEqual(expected);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("does not contain empty or unresolved migration files", () => {
    for (const filename of migrationFiles) {
      const sql = readFileSync(join(migrationsDirectory, filename), "utf8");

      expect(sql.trim().length, `${filename} must not be empty`).toBeGreaterThan(20);
      expect(sql, `${filename} contains a merge-conflict marker`).not.toMatch(
        /^(<{7}|={7}|>{7})/m,
      );
    }
  });

  it("keeps the enterprise control-plane foundation in the ordered chain", () => {
    expect(migrationFiles).toContain("0036_enterprise_security_and_scale_foundations.sql");
    const sql = readFileSync(
      join(migrationsDirectory, "0036_enterprise_security_and_scale_foundations.sql"),
      "utf8",
    );

    expect(sql).toContain("create table public.platform_security_controls");
    expect(sql).toContain("create table public.queue_outbox");
    expect(sql).toContain("create table public.audit_ledger");
    expect(sql).toContain("enable row level security");
  });

  it("keeps atomic deployment and rollback queues tenant-complete", () => {
    const sql = readFileSync(
      join(migrationsDirectory, "0047_tenant_safe_deployment_queue.sql"),
      "utf8",
    );
    expect(sql).toContain("create or replace function public.enqueue_deployment_job");
    expect(sql).toContain("create or replace function public.enqueue_rollback_job");
    expect(sql.match(/client_organization_id/g)?.length).toBeGreaterThanOrEqual(8);
    expect(sql).toContain("p_client_organization_id");
    expect(sql).toContain("v_source.client_organization_id");
  });
});
