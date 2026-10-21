import baseConfig from '@open-tomato/rafa-eslint-config';

/**
 * Root leaf: lints src/, scripts/, packages/ and root-level files.
 *
 * @type {import("eslint").Linter.Config} */
export default [
  {
    ignores: [
      // Agent-harness prose (skills/agents) was never a lint target in the
      // origin repos either.
      '.claude/**',
      // Loop state, gitignored: triage notes and reports rafa writes for
      // itself. `eslint .` reddened on a `.rafa/triage/` note whose fences
      // carry no language, which says nothing about this package's sources.
      '.rafa/**',
      '.tmp/**',
      '.docs/**',
      // The Atlas add-on: a proof of concept with its own package.json
      // and React/three stack, not a workspace and never published.
      'addons/atlas/**',
      // The declarations each code package's `tsc --build` writes, which
      // `eslint .` from the root otherwise lints after a `check-types` run.
      '**/.tsbuild/**',
    ],
  },
  ...baseConfig,
  {
    // The learning library's boundary: `src/learning/` is a pure library
    // shipped as `@open-tomato/rafa/learning`, so it imports nothing from
    // the rest of `src/` or from core's package, `packages/rafa/src/`, and
    // touches no filesystem. `node:crypto` (for sha256) and packages such
    // as `bun:test` stay allowed. The zones are resolved, not matched by
    // specifier, so `@open-tomato/rafa/core/config` from `src/learning/`
    // is refused while `../x.js` from a subdirectory of it is not.
    // `src/tests/learning-boundary.test.ts` lints a file planted under
    // `src/learning/` against this block.
    files: ['src/learning/**/*.ts'],
    rules: {
      'import/no-restricted-paths': ['error', {
        zones: [{
          target: './src/learning',
          from: './src',
          except: ['./learning'],
          message: 'src/learning/ imports nothing from the rest of src/.',
        }, {
          target: './src/learning',
          from: './packages/rafa/src',
          message: 'src/learning/ imports nothing from core.',
        }],
      }],
      'no-restricted-imports': ['error', {
        paths: ['node:fs', 'node:fs/promises', 'fs', 'fs/promises'].map(
          (name) => ({
            name,
            message: 'src/learning/ touches no filesystem.',
          }),
        ),
      }],
    },
  },
  {
    // A config section adds its fields to `RafaConfig` by declaration
    // merging: `interface RafaConfig extends HubSettings {}` inside a
    // `declare module` on `src/core/config/config-schema.ts`. The empty
    // body is the point, so these files alone allow an interface whose
    // one supertype is its whole content.
    files: ['src/config-schema-*.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': ['error', {
        allowInterfaces: 'with-single-extends',
      }],
    },
  },
];
