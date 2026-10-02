import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { config } from './shared/config.js';
import { authPlugin } from './plugins/auth.js';
import { errorHandlerPlugin } from './plugins/errorHandler.js';
import { registerModules } from './modules/index.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.NODE_ENV === 'test' ? 'silent' : config.isProduction ? 'info' : 'debug' },
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(helmet, {
    // The API serves JSON + generated PDFs; CSP is applied by the web tier.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' },
    }),
  });

  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 5 },
  });

  await app.register(authPlugin);
  await app.register(errorHandlerPlugin);

  app.get('/health', async () => ({ status: 'ok', service: 'egan-clinic-api', time: new Date().toISOString() }));

  await app.register(registerModules, { prefix: '/api' });

  return app;
}
