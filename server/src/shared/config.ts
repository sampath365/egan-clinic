import { z } from 'zod';

// Load .env for local development. In production the platform injects env vars.
try {
  // Node >= 20.12 provides process.loadEnvFile().
  (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.('.env');
} catch {
  // No .env file present — rely on the ambient environment.
}

/**
 * Environment configuration. Validated once at boot so a misconfigured
 * deployment fails fast instead of surfacing as a runtime error.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('file:./dev.db'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  REFRESH_EXPIRES_IN: z.string().default('30d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  STORAGE_DIR: z.string().default('./data/storage'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:5173'),
  WHATSAPP_API_URL: z.string().optional().default(''),
  WHATSAPP_API_TOKEN: z.string().optional().default(''),
  SMS_API_URL: z.string().optional().default(''),
  SMS_API_TOKEN: z.string().optional().default(''),
  EMAIL_SMTP_URL: z.string().optional().default(''),
  PUSH_API_URL: z.string().optional().default(''),
  PUSH_API_TOKEN: z.string().optional().default(''),
  VOICE_STT_API_URL: z.string().optional().default(''),
  VOICE_STT_API_KEY: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  corsOrigins: parsed.data.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
};

export type AppConfig = typeof config;
