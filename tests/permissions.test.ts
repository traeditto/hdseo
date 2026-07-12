import { describe, expect, it } from "vitest";
import { hasPermission } from "../lib/auth/permissions";

describe("agency permission matrix", () => {
  it("keeps paid operations away from viewers", () => expect(hasPermission("viewer", "provider.authorize")).toBe(false));
  it("allows directors to authorize paid operations", () => expect(hasPermission("seo_director", "provider.authorize")).toBe(true));
});
