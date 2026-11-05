import type { FormatContext, ValueFormat } from './format.js';
import type { ReactNode } from 'react';

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { FormatProvider, useFormatContext, useFormatter } from './FormatProvider.js';

/** A wrapper that puts `context` in scope. */
function within(context: FormatContext): (props: { children: ReactNode }) => ReactNode {
  function Within({ children }: { children: ReactNode }): ReactNode {
    return <FormatProvider context={context}>{children}</FormatProvider>;
  }
  return Within;
}

describe('useFormatter', () => {
  it('turns a spec into a valueFormat over the context in scope', () => {
    const { result } = renderHook(() => useFormatter({ kind: 'money' }), { wrapper: within({ locale: 'de-DE', currency: 'EUR' }) });

    expect(result.current?.(1234.5)).toBe('1.234,50 €');
  });

  it('uses the defaults outside a provider', () => {
    const { result } = renderHook(() => useFormatter({ kind: 'money' }));

    expect(result.current?.(1)).toBe('US$1.00');
    expect(renderHook(() => useFormatContext()).result.current).toEqual({});
  });

  it('returns undefined without a spec, so the primitive keeps its own default', () => {
    expect(renderHook(() => useFormatter()).result.current).toBeUndefined();
  });

  it('keeps the same function across renders of an equal inline spec', () => {
    const { result, rerender } = renderHook(({ spec }: { spec: ValueFormat }) => useFormatter(spec), {
      initialProps: { spec: { kind: 'percent' } },
    });
    const first = result.current;
    rerender({ spec: { kind: 'percent' } });

    expect(result.current).toBe(first);
    rerender({ spec: { kind: 'percent', digits: 1 } });
    expect(result.current).not.toBe(first);
  });

  it('resolves a custom id from the provider', () => {
    const tokens = (value: number): string => `${value} tok`;
    const { result } = renderHook(() => useFormatter({ kind: 'custom', id: 'tokens' }), { wrapper: within({ customFormatters: { tokens } }) });

    expect(result.current?.(3)).toBe('3 tok');
  });
});
