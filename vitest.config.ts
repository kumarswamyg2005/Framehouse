import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Loaded here rather than in a setup file so that both the Vitest main process
// and the worker processes it forks see the test database URL.
process.loadEnvFile('.env.test')

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    // Every test file shares one Postgres database and truncates between tests,
    // so they must not run concurrently.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: { '@': resolve(import.meta.dirname, '.') },
  },
})
