import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    include: ['src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@fearless-board/shared': path.resolve(import.meta.dirname, '../shared/src/index.ts'),
    },
  },
})
