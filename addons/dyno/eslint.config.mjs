import baseConfig from '@open-tomato/rafa-eslint-config';

/**
 * Add-on leaf: `eslint .` run from this folder lints the add-on alone on
 * the shared base, adding only its own ignores.
 *
 * @type {import("eslint").Linter.Config} */
export default [
  {
    ignores: [
      'node_modules/**',
    ],
  },
  ...baseConfig,
];
