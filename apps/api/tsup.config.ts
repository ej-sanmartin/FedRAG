import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  bundle: true,
  minify: process.env.NODE_ENV === 'production',
  sourcemap: process.env.NODE_ENV !== 'production',
  clean: true,
  // AWS SDK v3 is available in Lambda runtime, so we can externalize it
  external: ['@aws-sdk/*'],
  outDir: 'dist',
  splitting: false,
  treeshake: true,
  // Lambda-specific optimizations
  esbuildOptions(options) {
    // Ensure proper module resolution for Lambda
    options.mainFields = ['module', 'main']
    options.conditions = ['import', 'module', 'default']
    // Optimize for cold start performance
    options.keepNames = true
  },
  // Generate package.json for Lambda deployment
  onSuccess: async () => {
    const fs = await import('fs/promises')
    const packageJson = {
      type: 'module',
      main: 'index.js'
    }
    await fs.writeFile('dist/package.json', JSON.stringify(packageJson, null, 2))
  }
})