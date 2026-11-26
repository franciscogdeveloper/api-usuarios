import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

// Las variables de .env.test sobrescriben cualquier otra: los e2e nunca deben
// tocar la base de desarrollo.
const testEnv = parseEnv(readFileSync('.env.test', 'utf8')) as Record<
  string,
  string
>;
if (!/_test(\?|$)/.test(testEnv.DATABASE_URL ?? '')) {
  throw new Error('DATABASE_URL de .env.test debe apuntar a una base *_test');
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: testEnv,
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30000,
    fileParallelism: false,
  },
});
