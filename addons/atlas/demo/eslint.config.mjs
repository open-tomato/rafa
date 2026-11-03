import baseConfig from '@open-tomato/rafa-eslint-config';
import reactConfig from '@open-tomato/rafa-eslint-config/react';

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ['node_modules/**', '.tsbuild/**'] },
  ...baseConfig,
  ...reactConfig,
  {
    // The libraries' exports name their built dist/, and this package reads
    // their source through tsconfig `paths`, which the import resolver does
    // not follow. `tsc --build` holds those imports; the lint skips them.
    rules: {
      'import/no-unresolved': ['error', { ignore: ['^bun:', '^@open-tomato/(atlas-ui|charts)(/|$)'] }],
    },
  },
];
