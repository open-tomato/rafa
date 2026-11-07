import type { StorybookConfig } from '@storybook/react-vite';

import tailwindcss from '@tailwindcss/vite';

/**
 * Storybook 10 on its own Vite builder. Vite lives here only: the library
 * builds with `bun build` and the demo serves with `Bun.serve`. The
 * Tailwind plugin compiles the demo's `styles.css`, which `preview.ts`
 * imports, so stories never import tokens.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  typescript: {
    reactDocgen: 'react-docgen-typescript',
  },
  core: {
    disableTelemetry: true,
  },
  viteFinal: async (viteConfig) => ({
    ...viteConfig,
    plugins: [...(viteConfig.plugins ?? []), tailwindcss()],
  }),
};

export default config;
