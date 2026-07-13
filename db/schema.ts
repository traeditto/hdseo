// The portal's "live" data layer now reads and writes the shared Supabase
// Postgres schema (see `lib/live/store.ts` and `lib/live/identity.ts`), so the
// former Cloudflare D1 `live_*` tables are no longer defined here.
//
// This module is intentionally left without table definitions. It remains so
// that `db/index.ts` can keep passing a (now empty) schema map to Drizzle's D1
// client, which is only exercised by the standalone example under
// `examples/d1/` using its own local schema.

export {};
