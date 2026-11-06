import baseConfig from '@open-tomato/rafa-eslint-config';
import reactConfig from '@open-tomato/rafa-eslint-config/react';

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [
      'node_modules/**',
      '.tsbuild/**',
      'dist/**',
      'storybook-static/**',
      'visual/__image_snapshots__/**',
      'visual/__diff_output__/**',
    ],
  },
  ...baseConfig,
  ...reactConfig,
];
