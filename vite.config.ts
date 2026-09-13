/// <reference types="vitest" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { serviceWorkerBuildPlugin } from './build/serviceWorkerBuild.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serviceWorkerBuildPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'src/types/**',
        'src/__tests__/**',
        '**/*.config.{js,ts}',
        '**/*.d.ts',
      ],
    },
  },
})
