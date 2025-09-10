import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // Test environment configuration
    environment: 'jsdom',
    
    // Test file patterns
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
    
    // Global test setup
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.config.ts',
        'src/vite-env.d.ts',
        'src/main.tsx'
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70
        }
      }
    },
    
    // Test timeout
    testTimeout: 10000,
  },
  
  // Resolve configuration for tests
  resolve: {
    alias: {
      '@': '/src'
    }
  }
})