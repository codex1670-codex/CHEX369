import { z } from 'zod';

/**
 * Typed, validated environment. Everything optional stays optional, so the app still boots on a
 * laptop with no services; production misconfiguration is caught at startup, not at 3am.
 */
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  REDIS_URL: z.string().url().optional(),          // Redis or Valkey
  DATABASE_URL: z.string().url().optional(),       // PostgreSQL
  MONGODB_URI: z.string().optional(),
  AI_SERVICE_URL: z.string().url().optional(),     // FastAPI microservice
  AI_SERVICE_TOKEN: z.string().optional(),
  CORS_ORIGIN: z.string().default(''),
});

export type AppConfig = z.infer<typeof Env> & { corsOrigins: string[]; isProd: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  const c = parsed.data;
  return {
    ...c,
    isProd: c.NODE_ENV === 'production',
    corsOrigins: c.CORS_ORIGIN.split(',').map(x => x.trim()).filter(Boolean),
  };
}

export const config = loadConfig();
