import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'legacy/**',
      'node_modules/**',
      'output/**',
      'private/**',
      'runtime/**',
      'apps/desktop/launcher/dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['server/**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
  {
    files: ['server/**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['scripts/**/*.{js,mjs,cjs}', 'services/**/*.{js,mjs,cjs}', '*.config.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['apps/desktop/**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Attachment filenames deliberately reject ASCII control characters.
    files: ['services/identity/src/identity/feedbackAttachments.js'],
    rules: { 'no-control-regex': 'off' },
  },
  {
    files: ['apps/desktop/**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['apps/desktop/spike/page/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'apps/desktop/launcher/src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
);
