import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export default function setup(): void {
  const env = parseEnv(readFileSync('.env.test', 'utf8')) as Record<
    string,
    string
  >;
  if (!/_test(\?|$)/.test(env.DATABASE_URL ?? '')) {
    throw new Error('DATABASE_URL de .env.test debe apuntar a una base *_test');
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}
