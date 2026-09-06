import { execFileSync } from 'node:child_process'

/**
 * Brings the test database up to the committed migration history — the same SQL
 * that runs in production, rather than `db push`, so a migration that would fail
 * on deploy fails here first.
 */
export default function setup() {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: process.env,
  })
}
