import baseConfig from '@open-tomato/eslint-config';

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ['node_modules/**', '.tsbuild/**'] },
  ...baseConfig,
  // The shared base ignores every `build/` folder; `src/build/` here is source.
  { ignores: ['!src/build/**'] },
];
