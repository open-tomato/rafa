/**
 * Tone helpers shared by every engine. The names come from the theme's one
 * token list (`../theme/`), so there is no second list to keep in step.
 *
 * - `chartTone`: the CVA variant that sets `color`, so SVG marks paint with
 *   `currentColor`.
 * - `toneVar`: the same token as a CSS `var()` string, for engines that take a
 *   colour string per series.
 * - `readTokens`: the tokens read from the computed style of `<html>`, for
 *   canvas engines that cannot read CSS variables (ECharts);
 *   `useResolvedTokens` (`useResolvedTokens.ts`) re-reads them on a flip.
 * - `tokensFrom`: the same map from values a caller holds, for the headless
 *   engine, which has no page to read.
 *
 * No React here, so the headless engine can import it.
 */
import type { ChartTone } from './types.js';

import { cva, type VariantProps } from 'class-variance-authority';

import {
  POLE_TOKENS,
  SEQUENTIAL_TOKENS,
  SERIES_TOKENS,
  STATUS_TOKENS,
  SURFACE_TOKENS,
  THEME_TOKENS,
  TOKEN_PREFIX,
  tokenName,
  tokenNames,
  type TokenName,
} from '../theme/index.js';

/**
 * The CVA variants that set `color` to a tone's token. The class names are
 * written out in full so Tailwind can see them in this file.
 */
export const chartTone: (props?: ChartToneVariantProps) => string = cva('', {
  variants: {
    tone: {
      'series-1': 'text-series-1',
      'series-2': 'text-series-2',
      'series-3': 'text-series-3',
      'series-4': 'text-series-4',
      'series-5': 'text-series-5',
      'series-6': 'text-series-6',
      'series-7': 'text-series-7',
      'series-8': 'text-series-8',
      good: 'text-good',
      warning: 'text-warning',
      serious: 'text-serious',
      critical: 'text-critical',
      'pole-ship': 'text-pole-ship',
      'pole-ship-core': 'text-pole-ship-core',
      'pole-fail': 'text-pole-fail',
      'pole-fail-core': 'text-pole-fail-core',
      'pole-base': 'text-pole-base',
      'pole-base-core': 'text-pole-base-core',
      neutral: 'text-ink-2',
      muted: 'text-muted',
    },
  },
  defaultVariants: { tone: 'series-1' },
});

/** The variant props `chartTone` takes. */
export interface ChartToneVariantProps {
  readonly tone?: ChartTone | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type ChartToneVariants = VariantProps<typeof chartTone>;

/** Every tone, in the order the theme lists its tokens: series, status, poles, then the two neutrals. */
export const ALL_TONES: readonly ChartTone[] = [
  ...tokenNames(SERIES_TOKENS),
  ...tokenNames(STATUS_TOKENS),
  ...tokenNames(POLE_TOKENS),
  'neutral',
  'muted',
];

/** The sequential ramp (light to dark) as token names, for heatmaps. */
export const SEQUENTIAL_STEPS: readonly string[] = tokenNames(SEQUENTIAL_TOKENS).filter((name) => name.startsWith('seq-'));

/** Chrome roles the engines need beside the series tones. */
export const CHROME_ROLES: readonly string[] = tokenNames(SURFACE_TOKENS);

/** The token the `neutral` tone reads. */
const NEUTRAL_TOKEN = 'ink-2';

/** The token behind a tone: every tone is its own token except `neutral`, which reads as `ink-2`. */
function tokenOfTone(tone: ChartTone): string {
  return tone === 'neutral'
    ? NEUTRAL_TOKEN
    : tone;
}

/** `var(--color-<token>)` for a tone or a chrome role. */
export function toneVar(toneOrRole: ChartTone | string): string {
  const token = toneOrRole === 'neutral'
    ? NEUTRAL_TOKEN
    : toneOrRole;
  return `var(${TOKEN_PREFIX}${token})`;
}

/** Concrete colour strings keyed by tone and by token name (`series-1`, `ink`, `seq-300`). */
export type ResolvedTokens = Record<string, string>;

/** Reads every token from the computed style of `<html>`; a name the theme leaves undefined reads as an empty string. */
export function readTokens(): ResolvedTokens {
  const out: ResolvedTokens = {};
  if (typeof document === 'undefined') return out;
  const style = getComputedStyle(document.documentElement);
  const names = [...ALL_TONES.map(tokenOfTone), ...SEQUENTIAL_STEPS, ...CHROME_ROLES];
  for (const name of names) {
    out[name] = style.getPropertyValue(`${TOKEN_PREFIX}${name}`).trim();
  }
  for (const tone of ALL_TONES) {
    out[tone] = out[tokenOfTone(tone)] ?? '';
  }
  return out;
}

/**
 * The resolved tokens from values the caller holds, keyed by token name
 * without its prefix (`series-1`, `ink`, `seq-300`): every token is kept
 * under its name and every tone under its own, `neutral` reading `ink-2`.
 * A headless caller has no CSS variables to read, so it passes the full set.
 */
export function tokensFrom(values: Readonly<Record<TokenName, string>>): ResolvedTokens {
  const out: ResolvedTokens = {};
  for (const token of THEME_TOKENS) {
    const name = tokenName(token);
    out[name] = values[name];
  }
  for (const tone of ALL_TONES) {
    out[tone] = out[tokenOfTone(tone)] ?? '';
  }
  return out;
}
