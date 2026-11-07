import baseConfig from '@open-tomato/eslint-config';
import { CODE_FILES } from '@open-tomato/eslint-config/files';

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
      // Gitignored local scratch (bake-offs, session notes): never in CI's tree.
      '.local/**',
      '.docs/**',
      // The declarations each code package's `tsc --build` writes, which
      // `eslint .` from the root otherwise lints after a `check-types` run.
      '**/.tsbuild/**',
      // The Atlas libraries' build outputs (`charts`, `ui`): the bundles,
      // the built Storybooks and the visual suites' per-machine baselines.
      'addons/atlas/*/dist/**',
      'addons/atlas/*/storybook-static/**',
      'addons/atlas/*/visual/__image_snapshots__/**',
      'addons/atlas/*/visual/__diff_output__/**',
    ],
  },
  ...baseConfig,
  {
    // The shared base resolves imports through the tsconfig of each folder
    // under packages/, apps/ and services/; this repository also has the
    // Atlas add-ons under addons/atlas/.
    files: CODE_FILES,
    settings: {
      'import/resolver': {
        typescript: {
          noWarnOnMultipleProjects: true,
          project: ['./tsconfig.json', './packages/*/tsconfig.json', './addons/atlas/*/tsconfig.json'],
        },
      },
    },
  },
  {
    // The demo reads `@open-tomato/atlas-ui` through tsconfig `paths`, which
    // the import resolver does not follow, and the library's exports name a
    // dist/ that CI's lint step never builds. `tsc --build` holds these
    // imports; the demo's own leaf config skips them the same way.
    files: ['addons/atlas/demo/**'],
    rules: {
      'import/no-unresolved': ['error', { ignore: ['^bun:', '^@open-tomato/atlas-ui(/|$)'] }],
    },
  },
  {
    // The learning library's boundary: `packages/rafa-inventory/src/learning/`
    // is a pure library shipped as `@open-tomato/rafa/learning`, so it imports
    // nothing from the rest of inventory's `src/` or from core's package,
    // `packages/rafa/src/`, and touches no filesystem. `node:crypto` (for
    // sha256) and packages such as `bun:test` stay allowed. The zones are
    // resolved, not matched by specifier, so `@open-tomato/rafa/core/config`
    // from that folder is refused while `../x.js` from a subdirectory of it
    // is not. `src/tests/learning-boundary.test.ts` lints a file planted under
    // `packages/rafa-inventory/src/learning/` against this block.
    files: ['packages/rafa-inventory/src/learning/**/*.ts'],
    rules: {
      'import/no-restricted-paths': ['error', {
        zones: [{
          target: './packages/rafa-inventory/src/learning',
          from: './packages/rafa-inventory/src',
          except: ['./learning'],
          message: 'packages/rafa-inventory/src/learning/ imports nothing from the rest of the package\'s src/.',
        }, {
          target: './packages/rafa-inventory/src/learning',
          from: './packages/rafa/src',
          message: 'packages/rafa-inventory/src/learning/ imports nothing from core.',
        }],
      }],
      'no-restricted-imports': ['error', {
        paths: ['node:fs', 'node:fs/promises', 'fs', 'fs/promises'].map(
          (name) => ({
            name,
            message: 'packages/rafa-inventory/src/learning/ touches no filesystem.',
          }),
        ),
      }],
    },
  },
  {
    // A config section adds its fields to `RafaConfig` by declaration
    // merging: `interface RafaConfig extends HubSettings {}` inside a
    // `declare module` on `packages/rafa/src/core/config/config-schema.ts`.
    // The empty body is the point, so these files alone, in core's
    // package, allow an interface whose one supertype is its whole content.
    files: ['packages/rafa/src/config-schema-*.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': ['error', {
        allowInterfaces: 'with-single-extends',
      }],
    },
  },
];
