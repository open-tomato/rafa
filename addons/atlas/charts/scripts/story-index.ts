/**
 * The story ids of a built Storybook, read from its `index.json`, and the
 * iframe URL that renders one story in one theme.
 */
import { join } from 'node:path';

/** The themes every story is loaded in. */
export const THEMES = ['light', 'dark'] as const;
export type Theme = typeof THEMES[number];

interface IndexEntry {
  readonly id: string;
  readonly type: string;
}

/** Every story id in `<staticDir>/index.json`, sorted; docs pages are left out. */
export async function readStoryIds(staticDir: string): Promise<string[]> {
  const index = (await Bun.file(join(staticDir, 'index.json')).json()) as { entries: Record<string, IndexEntry> };
  return Object.values(index.entries)
    .filter((entry) => entry.type === 'story')
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));
}

/** The path that renders story `id` alone, in `theme`. */
export function storyPath(id: string, theme: Theme): string {
  return `/iframe.html?id=${encodeURIComponent(id)}&viewMode=story&globals=theme:${theme}`;
}
