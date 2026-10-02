import type { FastifyRequest } from 'fastify';
import { z, type ZodTypeAny } from 'zod';
import { AppError } from './errors.js';

/**
 * Parses and validates request input with Zod. Invalid input is rejected with a
 * 422 before it reaches a service. Schemas use `.strict()` where extra keys
 * could otherwise be smuggled into persistence calls.
 */
export function parseBody<T extends ZodTypeAny>(req: FastifyRequest, schema: T): z.infer<T> {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw AppError.unprocessable('Request validation failed', result.error.flatten());
  }
  return result.data;
}

export function parseQuery<T extends ZodTypeAny>(req: FastifyRequest, schema: T): z.infer<T> {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    throw AppError.unprocessable('Query validation failed', result.error.flatten());
  }
  return result.data;
}

export function parseParams<T extends ZodTypeAny>(req: FastifyRequest, schema: T): z.infer<T> {
  const result = schema.safeParse(req.params);
  if (!result.success) {
    throw AppError.unprocessable('Path validation failed', result.error.flatten());
  }
  return result.data;
}

export const idParamSchema = z.object({ id: z.string().min(1).max(64) });
