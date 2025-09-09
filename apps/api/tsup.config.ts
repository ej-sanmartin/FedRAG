import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  bundle: true,
  minify: true,
  sourcemap: true,
  clean: true,
  external: ['@aws-sdk/*'],
  outDir: 'dist',
  splitting: false,
  treeshake: true
})