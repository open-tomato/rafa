import baseConfig from '@open-tomato/rafa-eslint-config';

/**
 * Package leaf: `eslint .` run from this package's directory lints the
 * package alone on the shared base, adding only the package's own ignores
 * and the section-file block the root's leaf also names.
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
  {
    // A config section adds its fields to `RafaConfig` by declaration
    // merging: `interface RafaConfig extends BugsSettings {}` inside a
    // `declare module` on `src/core/config/config-schema.ts`. The empty
    // body is the point, so these files alone allow an interface whose
    // one supertype is its whole content, as the root's leaf allows them.
    files: ['src/config-schema-*.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': ['error', {
        allowInterfaces: 'with-single-extends',
      }],
    },
  },
];
