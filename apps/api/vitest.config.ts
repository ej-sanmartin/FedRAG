import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Test environment configuration
    environment: 'node',
    
    // Test file patterns
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.config.ts',
        'src/types.ts'
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    },
    
    // Test timeout for AWS SDK calls
    testTimeout: 10000,
    
    // Global test setup
    globals: true,
    
    // Mock AWS SDK by default
    setupFiles: ['./src/test-setup.ts']
  },
  
  // ESBuild configuration for TypeScript
  esbuild: {
    target: 'node20'
  }
})