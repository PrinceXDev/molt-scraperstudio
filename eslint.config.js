import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Lint configuration.
 *
 * Deliberately not type-aware. `tsc` already runs across every package under full
 * strictness in both CI and `pnpm typecheck`, so duplicating that here would cost
 * minutes of CI time to re-derive facts we already have. What is left for ESLint
 * is the class of thing a type checker cannot see: unused code, shadowed names,
 * and accidental `any`.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/coverage/**',
      'apps/chaos/dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Everything here runs on Node: the CLI, the build scripts, the tests.
    languageOptions: {
      globals: globals.node,
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // Underscore-prefixed names are intentional discards, most often the
      // omitted half of an object destructure.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
    },
  },
  {
    // The CLI's whole purpose is to write to the terminal, and it does so through
    // process.stdout rather than console, which the rule above already forbids.
    files: ['apps/sentinel/**/*.ts', 'apps/chaos/**/*.ts', 'scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
);
