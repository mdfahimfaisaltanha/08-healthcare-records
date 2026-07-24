import { Pool } from "pg"

/** Shared Postgres pool (serverless-friendly: small max, idle timeout). */
let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env.local, point it at Postgres (Neon/Supabase free tiers work), then run `npm run setup`.",
      )
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
    })
  }
  return pool
}
