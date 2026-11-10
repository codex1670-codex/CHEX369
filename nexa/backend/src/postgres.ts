import pg from 'pg';
import { config } from './config.js';

/**
 * PostgreSQL connection pool (relational data: accounts, follows, messages, coins).
 * Phase 2 moves these tables off SQLite; until then this powers the health check and new features.
 */
export const pool: pg.Pool | null = config.DATABASE_URL
  ? new pg.Pool({ connectionString: config.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000 })
  : null;

pool?.on('error', (err: Error) => console.warn('[nexa] postgres pool error:', err.message));

export async function pgHealthy(): Promise<boolean | null> {
  if (!pool) return null; // not configured
  try { await pool.query('SELECT 1'); return true; } catch { return false; }
}
