module.exports = {
  root: true,
  env: { 
    browser: true, 
    es2020: true 
  },
  extends: [
    'eslint:recommended'
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    'no-unused-vars': 'warn',
    'no-console': 'warn'
  },
  overrides: [
    {
      files: ['**/*.{ts,tsx}'],
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint', 'react-refresh'],
      env: {
        browser: true,
        es2020: true
      },
      rules: {
        'no-unused-vars': 'off',
        'no-undef': 'off', // TypeScript handles this
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        '@typescript-eslint/no-explicit-any': 'warn',
        'react-refresh/only-export-components': [
          'warn',
          { allowConstantExport: true }
        ]
      }
    },
    {
      // Allow console statements in development and configuration files
      files: [
        'src/lib/debug.ts',
        'src/lib/config.ts',
        'src/main.tsx',
        'vite.config.ts',
        '*.config.{js,ts}'
      ],
      rules: {
        'no-console': 'off'
      }
    }
  ]
}