import baseConfig from '@open-tomato/eslint-config';

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ['node_modules/**', '.tsbuild/**'] },
  ...baseConfig,
];
