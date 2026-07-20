import { describe, expect, it } from "vitest";
import { hasPermission } from "../lib/auth/permissions";

describe("agency permission matrix", () => {
  it("keeps paid operations away from viewers", () => expect(hasPermission("viewer", "provider.authorize")).toBe(false));
  it("allows directors to authorize paid operations", () => expect(hasPermission("seo_director", "provider.authorize")).toBe(true));
  it("does not invent read access for unknown permissions", () => expect(hasPermission("agency_owner", "secrets.read")).toBe(false));
  it("grants only explicitly listed read access", () => expect(hasPermission("content_editor", "seo.read")).toBe(true));
});
