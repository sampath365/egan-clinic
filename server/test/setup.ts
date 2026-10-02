/**
 * Vitest setup. Loads the server environment (including .env) before any test
 * module imports the config, so DATABASE_URL and JWT_SECRET are available.
 */
import { config } from '../src/shared/config.js';

export const TEST_PASSWORD = 'Password123!';

// Fail fast with a clear message if the environment is not ready for tests.
if (!config.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set for tests (copy .env.example to .env).');
}
