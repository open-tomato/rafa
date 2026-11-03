import '../../demo/src/styles.css';
import './preview.css';

import type { Preview } from '@storybook/react-vite';

/** The two themes; dark is `data-theme="dark"` on `<html>`. */
const THEMES = ['light', 'dark'] as const;

/**
 * Every story renders over the demo's token values (light `@theme` and the
 * dark re-step), and the `theme` toolbar global sets `data-theme` on the
 * document, as the consuming app does. The visual suite and
 * `check:stories` pick a theme with `&globals=theme:dark`.
 */
const preview: Preview = {
  parameters: {
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
  },
  globalTypes: {
    theme: {
      description: 'Colour theme',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: THEMES.map((value) => ({ value, title: value === 'dark'
          ? 'Dark'
          : 'Light' })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'light',
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals['theme'] === 'dark'
        ? 'dark'
        : 'light';
      document.documentElement.setAttribute('data-theme', theme);
      return Story();
    },
  ],
};

export default preview;
