import baseConfig from '@open-tomato/rafa-eslint-config';
import reactConfig from '@open-tomato/rafa-eslint-config/react';

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [
      'node_modules/**',
      '.tsbuild/**',
      'dist/**',
      'storybook-static/**',
      'visual/__image_snapshots__/**',
      'visual/__diff_output__/**',
      'visual/__compare_output__/**',
    ],
  },
  ...baseConfig,
  ...reactConfig,
  {
    // `@open-tomato/charts` exports its built dist/, and this package reads
    // its source through tsconfig `paths`, which the import resolver does
    // not follow. `tsc --build` holds those imports; the lint skips them.
    rules: {
      'import/no-unresolved': ['error', { ignore: ['^bun:', '^@open-tomato/charts(/|$)'] }],
    },
  },
];
