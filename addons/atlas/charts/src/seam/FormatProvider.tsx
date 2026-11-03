/**
 * The format context as React state: `FormatProvider` puts a locale, a
 * currency and the custom formatters in scope, and `useFormatter` turns a
 * `ValueFormat` into a primitive's `valueFormat` function over them. Kept
 * apart from `format.ts`, so the headless engine imports no React.
 */
import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';

import { formatterFor, type FormatContext, type ValueFormat, type ValueFormatter } from './format.js';

const FormatContextState = createContext<FormatContext>({});

/** The props of {@link FormatProvider}. */
export interface FormatProviderProps {
  /** The locale, currency and custom formatters below; keep the object stable across renders. */
  readonly context: FormatContext;
  readonly children: ReactNode;
}

/** Puts one format context in scope for the charts below it. */
export function FormatProvider({ context, children }: FormatProviderProps): ReactElement {
  return <FormatContextState.Provider value={context}>{children}</FormatContextState.Provider>;
}

/** The format context in scope; the defaults (`en-GB`, `USD`, `UTC`) outside a provider. */
export function useFormatContext(): FormatContext {
  return useContext(FormatContextState);
}

/**
 * `spec` as a `valueFormat` function over the context in scope, or
 * undefined when `spec` is, so the primitive keeps its own default. The
 * function is rebuilt only when the spec's content or the context changes,
 * so an inline spec literal does not redraw the chart.
 */
export function useFormatter(spec?: ValueFormat): ValueFormatter | undefined {
  const context = useFormatContext();
  const key = spec === undefined
    ? undefined
    : JSON.stringify(spec);
  return useMemo(
    () => (key === undefined
      ? undefined
      : formatterFor(JSON.parse(key) as ValueFormat, context)),
    [key, context],
  );
}
