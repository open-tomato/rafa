import baseConfig from '@open-tomato/rafa-eslint-config';

/**
 * Package leaf: `eslint .` run from this package's directory lints the
 * package alone on the shared base, adding only the package's own ignores.
 *
 * @type {import("eslint").Linter.Config} */
export default [
  {
    ignores: [
      '.tsbuild/**',
      'node_modules/**',
    ],
  },
  ...baseConfig,
];
