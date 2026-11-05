import baseConfig from '@open-tomato/rafa-eslint-config';

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ['node_modules/**', '.tsbuild/**'] },
  ...baseConfig,
];
