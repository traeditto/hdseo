interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
}

interface D1PreparedStatement {
  readonly __d1PreparedStatementBrand?: "D1PreparedStatement";
}

declare module "cloudflare:workers" {
  // The concrete binding type is supplied by Wrangler at deploy time.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const env: { DB?: any } & Record<string, unknown>;
}
