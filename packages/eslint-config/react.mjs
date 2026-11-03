import * as tsParser from '@typescript-eslint/parser';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

import otPlugin from './rules/cva-only-classname.mjs';

/**
 * The React block: TSX and JSX files only, laid over `./base.mjs` by the
 * leaf configs that hold React (the Atlas charts, ui and demo). The
 * new JSX transform needs no React in scope, and TypeScript carries the
 * prop types, so those two rules are off.
 *
 * `ot/cva-only-classname` (`rules/cva-only-classname.mjs`) holds every
 * `className` to a variants call, a `cn()` over variants and the
 * passthrough, or the passthrough alone. Templates, pages, stories and
 * tests are left out: a page lays out its cards, a story's decorator may
 * hold a layout class, and a test hands a class in to prove the
 * passthrough.
 *
 * @type {import("eslint").Linter.Config[]} */
export default [
  {
    files: ['**/*.tsx', '**/*.jsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react },
    settings: {
      react: { version: 'detect' },
      'import/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx', '.d.ts'] },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
  { files: ['**/*.tsx', '**/*.jsx'], ...reactHooks.configs.flat.recommended },
  { files: ['**/*.tsx', '**/*.jsx'], ...jsxA11y.flatConfigs.recommended },
  {
    files: ['**/*.tsx', '**/*.jsx'],
    ignores: ['**/templates/**', '**/pages/**', '**/*.stories.tsx', '**/*.test.tsx'],
    plugins: { ot: otPlugin },
    rules: { 'ot/cva-only-classname': 'error' },
  },
];
