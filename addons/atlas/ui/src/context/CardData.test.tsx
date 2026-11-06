import type { TimeRange } from '../contract/schemas.js';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';
import { useState, type ReactElement } from 'react';

import { CardData, useCardData } from './CardData.js';

/** A source answering after `tick()`, recording each range it was asked for. */
function deferredSource(): { source: (range: TimeRange | undefined) => Promise<string>; asked: (TimeRange | undefined)[]; settle: (value: string | Error) => Promise<void> } {
  const asked: (TimeRange | undefined)[] = [];
  let pending: ((value: string | Error) => void) | null = null;
  const source = (range: TimeRange | undefined): Promise<string> => {
    asked.push(range);
    return new Promise((resolve, reject) => {
      pending = (value) => (value instanceof Error
        ? reject(value)
        : resolve(value));
    });
  };
  const settle = async (value: string | Error): Promise<void> => {
    await act(async () => {
      pending?.(value);
      await Promise.resolve();
    });
  };
  return { source, asked, settle };
}

function Probe(): ReactElement {
  const { data, status, error, refresh, range } = useCardData<string>();
  return (
    <div>
      <p data-testid="state">{`${status}:${data ?? '-'}:${error?.message ?? '-'}:${range ?? '-'}`}</p>
      <button type="button" onClick={refresh}>refresh</button>
    </div>
  );
}

/** Flushes the microtasks a source's promise chain needs to reach React. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('CardData', () => {
  it('hands static data to the card as ready', () => {
    render(<CardData data="static"><Probe /></CardData>);

    expect(screen.getByTestId('state').textContent).toBe('ready:static:-:-');
  });

  it('asks the source for the range and reports loading, then ready', async () => {
    const { source, asked, settle } = deferredSource();
    render(<CardData source={source} range="last-week"><Probe /></CardData>);
    await flush();

    expect(screen.getByTestId('state').textContent).toBe('loading:-:-:last-week');
    await settle('week');
    expect(screen.getByTestId('state').textContent).toBe('ready:week:-:last-week');
    expect(asked).toEqual(['last-week']);
  });

  it('keeps the last answer while a refresh loads, then shows the new one', async () => {
    const { source, settle } = deferredSource();
    render(<CardData source={source}><Probe /></CardData>);
    await flush();
    await settle('first');
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    await flush();

    expect(screen.getByTestId('state').textContent).toBe('loading:first:-:-');
    await settle('second');
    expect(screen.getByTestId('state').textContent).toBe('ready:second:-:-');
  });

  it('reports a rejected source as an error', async () => {
    const { source, settle } = deferredSource();
    render(<CardData source={source}><Probe /></CardData>);
    await flush();
    await settle(new Error('offline'));

    expect(screen.getByTestId('state').textContent).toBe('error:-:offline:-');
  });

  it('asks again when the range changes', async () => {
    const { source, asked } = deferredSource();
    function Ranged(): ReactElement {
      const [range, setRange] = useState<TimeRange>('now');
      return (
        <CardData source={source} range={range}>
          <button type="button" onClick={() => setRange('last-year')}>year</button>
        </CardData>
      );
    }
    render(<Ranged />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'year' }));
    await flush();

    expect(asked).toEqual(['now', 'last-year']);
  });

  it('throws a clear error outside a CardData', () => {
    const original = console.error;
    console.error = () => undefined;
    try {
      expect(() => render(<Probe />)).toThrow('useCardData() needs a <CardData> above it.');
    } finally {
      console.error = original;
    }
  });
});
