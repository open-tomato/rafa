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
      '.plans/**',
      '.specs/**',
      '.tmp/**',
      '.docs/**',
    ],
  },
  ...baseConfig,
];
