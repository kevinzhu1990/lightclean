import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: ['verbose'],
    pool: 'threads',
    // GitHub's Windows runner can terminate the test process when Vitest
    // starts too many workers alongside native/WASM modules.
    maxWorkers: 2,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
})
