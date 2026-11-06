import { defineConfig, devices } from '@playwright/test';

/**
 * The visual suite: every story of the built Storybook, light and dark,
 * against baselines this machine wrote. Baselines are per machine and
 * untracked (`__image_snapshots__/`), so CI runs no visual gate yet.
 */

/** Not 6006, so a running `storybook dev` never collides with it. */
const PORT = 6016;

export default defineConfig({
  testDir: '.',
  testMatch: '*.visual.ts',
  snapshotPathTemplate: '{testDir}/__image_snapshots__/{arg}{ext}',
  outputDir: './__diff_output__',
  fullyParallel: true,
  forbidOnly: true,
  reporter: 'list',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      threshold: 0.1,
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: `bun ../scripts/serve-static.ts ../storybook-static ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.json`,
    reuseExistingServer: false,
  },
});
