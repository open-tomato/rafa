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
      '.plans/**',
      '.specs/**',
      '.tmp/**',
      '.docs/**',
    ],
  },
  ...baseConfig,
];
