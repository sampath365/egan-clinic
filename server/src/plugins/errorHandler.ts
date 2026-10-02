import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors.js';
import { config } from '../shared/config.js';

/**
 * Global error handler. Translates known error types into a stable JSON shape
 * and never leaks stack traces or internal details to the client.
 */
export const errorHandlerPlugin = fp(async (app: FastifyInstance) => {
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` },
    });
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    if (error instanceof ZodError) {
      return reply.code(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.flatten(),
        },
      });
    }

    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    }

    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    if (statusCode >= 500) {
      req.log.error({ err: error }, 'Unhandled error');
      return reply.code(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: config.isProduction ? 'Something went wrong' : (error as Error).message,
        },
      });
    }

    return reply.code(statusCode).send({
      error: { code: 'REQUEST_ERROR', message: (error as Error).message },
    });
  });
});
