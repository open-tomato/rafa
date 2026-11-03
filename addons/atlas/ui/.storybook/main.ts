import type { StorybookConfig } from '@storybook/react-vite';
import type { Alias, AliasOptions } from 'vite';

import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';

/** `@open-tomato/charts` read from its source, as tsc and Bun read it through `paths`. */
const CHARTS_SOURCE = fileURLToPath(new URL('../../charts/src/index.ts', import.meta.url));

/** Vite's alias option, which is a map or a list, as a list. */
function aliasList(alias: AliasOptions | undefined): Alias[] {
  if (alias === undefined) return [];
  if (Array.isArray(alias)) return [...(alias as readonly Alias[])];
  return Object.entries(alias as Record<string, string>).map(([find, replacement]) => ({ find, replacement }));
}

/**
 * Storybook 10 on its own Vite builder. Vite lives here only: the library
 * builds with `bun build` and the demo serves with `Bun.serve`. The
 * Tailwind plugin compiles the demo's `styles.css`, which `preview.ts`
 * imports, so stories never import tokens. The alias points
 * `@open-tomato/charts` at the sibling package's source, so no build of it
 * comes first.
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
    resolve: {
      ...viteConfig.resolve,
      alias: [
        ...aliasList(viteConfig.resolve?.alias),
        { find: /^@open-tomato\/charts$/, replacement: CHARTS_SOURCE },
      ],
    },
  }),
};

export default config;
