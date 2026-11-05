/**
 * The resolved tokens as React state: read from the computed style of
 * `<html>` and re-read when the theme attribute flips, for canvas engines
 * that cannot read CSS variables (ECharts). Kept apart from `tones.ts`, so
 * the headless engine imports no React.
 */
import { useEffect, useState } from 'react';

import { THEME_ATTRIBUTE } from '../theme/index.js';

import { readTokens, type ResolvedTokens } from './tones.js';

/** Whether two readings hold the same colour under every name. */
function sameTokens(a: ResolvedTokens, b: ResolvedTokens): boolean {
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((name) => a[name] === b[name]);
}

/**
 * The tokens as concrete colour strings, keyed by tone and by token name,
 * re-read when the theme attribute changes on `<html>`. A write that leaves
 * every colour as it was returns the same object, so a chart is not redrawn.
 */
export function useResolvedTokens(): ResolvedTokens {
  const [tokens, setTokens] = useState<ResolvedTokens>(() => readTokens());
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const next = readTokens();
      setTokens((previous) => (sameTokens(previous, next)
        ? previous
        : next));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [THEME_ATTRIBUTE] });
    return () => observer.disconnect();
  }, []);
  return tokens;
}
