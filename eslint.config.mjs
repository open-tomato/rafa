import baseConfig from './eslint.base.mjs';

/**
 * Root leaf: lints src/, scripts/ and root-level files.
 *
 * @type {import("eslint").Linter.Config} */
export default [
  {
    ignores: [
      'packages/**',
      // Agent-harness prose (skills/agents) was never a lint target in the
      // origin repos either.
      '.claude/**',
      // Loop state, gitignored: triage notes and reports rafa writes for
      // itself. `eslint .` reddened on a `.rafa/triage/` note whose fences
      // carry no language, which says nothing about this package's sources.
      '.rafa/**',
      '.tmp/**',
      '.docs/**',
    ],
  },
  ...baseConfig,
  {
    // The learning library's boundary: `src/learning/` is a pure library
    // shipped as `@open-tomato/rafa/learning`, so it imports nothing from
    // the rest of `src/` and touches no filesystem. `node:crypto` (for
    // sha256) and packages such as `bun:test` stay allowed. The zone is
    // resolved, not matched by specifier, so `../config.js` from
    // `src/learning/` is refused while `../x.js` from a subdirectory of it
    // is not. `src/tests/learning-boundary.test.ts` lints a file planted
    // under `src/learning/` against this block.
    files: ['src/learning/**/*.ts'],
    rules: {
      'import/no-restricted-paths': ['error', {
        zones: [{
          target: './src/learning',
          from: './src',
          except: ['./learning'],
          message: 'src/learning/ imports nothing from the rest of src/.',
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
];
