import baseConfig from '@open-tomato/eslint-config';
import cvaConfig from '@open-tomato/eslint-config/cva';
import reactConfig from '@open-tomato/eslint-config/react';

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
  ...cvaConfig,
  {
    // Story fixtures are story code: a layout class on a demo tile is the point.
    files: ['src/stories/**'],
    rules: { '@open-tomato/cva-only-classname': 'off' },
  },
  {
    // `@open-tomato/charts` exports its built dist/, and this package reads
    // its source through tsconfig `paths`, which the import resolver does
    // not follow. `tsc --build` holds those imports; the lint skips them.
    rules: {
      'import/no-unresolved': ['error', { ignore: ['^bun:', '^@open-tomato/charts(/|$)'] }],
    },
  },
];
