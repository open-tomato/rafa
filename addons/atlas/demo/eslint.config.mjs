import baseConfig from '@open-tomato/eslint-config';
import cvaConfig from '@open-tomato/eslint-config/cva';
import reactConfig from '@open-tomato/eslint-config/react';

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ['node_modules/**', '.tsbuild/**'] },
  ...baseConfig,
  ...reactConfig,
  ...cvaConfig,
  {
    // atlas-ui's exports name its built dist/, and this package reads its
    // source through tsconfig `paths`, which the import resolver does not
    // follow. `tsc --build` holds those imports; the lint skips them.
    rules: {
      'import/no-unresolved': ['error', { ignore: ['^bun:', '^@open-tomato/atlas-ui(/|$)'] }],
    },
  },
];
