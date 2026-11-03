/**
 * The theme contract: the CSS custom properties this library reads, by
 * name. The library ships no values. The consuming app defines every name
 * below, light values in its Tailwind `@theme` block and a dark re-step
 * under `:root[data-theme="dark"]`; `@open-tomato/atlas-demo`'s
 * `src/styles.css` is the reference set.
 *
 * Each name is a Tailwind v4 colour token, so `--color-series-1` is also
 * the class family `bg-series-1`, `text-series-1`, `stroke-series-1`.
 */

/** Categorical series colours, in the order a chart assigns them. */
export const SERIES_TOKENS = [
  '--color-series-1',
  '--color-series-2',
  '--color-series-3',
  '--color-series-4',
  '--color-series-5',
  '--color-series-6',
  '--color-series-7',
  '--color-series-8',
] as const;

/** Status colours, mildest to worst. */
export const STATUS_TOKENS = [
  '--color-good',
  '--color-warning',
  '--color-serious',
  '--color-critical',
] as const;

/** Surfaces, text and chart furniture. */
export const SURFACE_TOKENS = [
  '--color-surface',
  '--color-plane',
  '--color-ink',
  '--color-ink-2',
  '--color-muted',
  '--color-grid',
  '--color-baseline',
  '--color-ring',
] as const;

/** The sequential ramp, lightest to darkest, and the diverging midpoint. */
export const SEQUENTIAL_TOKENS = [
  '--color-seq-100',
  '--color-seq-200',
  '--color-seq-300',
  '--color-seq-400',
  '--color-seq-500',
  '--color-seq-600',
  '--color-seq-700',
  '--color-diverge-mid',
] as const;

/** The balance poles: the rim colour and the `-core` colour at the centre. */
export const POLE_TOKENS = [
  '--color-pole-ship',
  '--color-pole-ship-core',
  '--color-pole-fail',
  '--color-pole-fail-core',
  '--color-pole-base',
  '--color-pole-base-core',
] as const;

/** Change indicators: a rise read as good. */
export const DELTA_TOKENS = [
  '--color-delta-up',
] as const;

/** One token name the library reads. */
export type ThemeToken =
  | typeof SERIES_TOKENS[number]
  | typeof STATUS_TOKENS[number]
  | typeof SURFACE_TOKENS[number]
  | typeof SEQUENTIAL_TOKENS[number]
  | typeof POLE_TOKENS[number]
  | typeof DELTA_TOKENS[number];

/** Every token name, grouped as above; the list a theme must define in full. */
export const THEME_TOKENS: readonly ThemeToken[] = [
  ...SERIES_TOKENS,
  ...STATUS_TOKENS,
  ...SURFACE_TOKENS,
  ...SEQUENTIAL_TOKENS,
  ...POLE_TOKENS,
  ...DELTA_TOKENS,
];

/** The attribute on `<html>` that switches the theme, and its dark value. */
export const THEME_ATTRIBUTE = 'data-theme';

/** The value of {@link THEME_ATTRIBUTE} that selects the dark re-step. */
export const DARK_THEME = 'dark';

/** A `var()` reference to one token, for the canvas bridge and inline SVG paint. */
export function tokenVar(token: ThemeToken): string {
  return `var(${token})`;
}

/** The prefix every token name shares; Tailwind v4 reads `--color-<name>` as the `<name>` colour. */
export const TOKEN_PREFIX = '--color-';

/** A token's name without {@link TOKEN_PREFIX}: `--color-series-1` is `series-1`, the spelling of a chart tone and of a class family. */
export type TokenName<T extends ThemeToken = ThemeToken> = T extends `${typeof TOKEN_PREFIX}${infer Name}` ? Name : never;

/** The name of one token, without its prefix. */
export function tokenName<T extends ThemeToken>(token: T): TokenName<T> {
  return token.slice(TOKEN_PREFIX.length) as TokenName<T>;
}

/** The names of a list of tokens, in the list's order. */
export function tokenNames<T extends ThemeToken>(tokens: readonly T[]): TokenName<T>[] {
  return tokens.map((token) => tokenName(token));
}
