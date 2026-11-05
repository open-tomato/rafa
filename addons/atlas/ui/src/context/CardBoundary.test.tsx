import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { useState, type ReactElement } from 'react';

import { CardBoundary } from './CardBoundary.js';

function Thrower({ fail }: { readonly fail: boolean }): ReactElement {
  if (fail) throw new Error('chart broke');
  return <p>chart</p>;
}

const originalError = console.error;

describe('CardBoundary', () => {
  beforeEach(() => {
    console.error = () => undefined;
  });

  afterEach(() => {
    console.error = originalError;
  });

  it('renders its children while nothing throws', () => {
    render(<CardBoundary><Thrower fail={false} /></CardBoundary>);

    expect(screen.getByText('chart')).toBeDefined();
  });

  it('catches a throw, shows the default status and tells onError', () => {
    const onError = mock<(error: Error) => void>(() => undefined);
    render(<CardBoundary onError={onError}><Thrower fail /></CardBoundary>);

    expect(screen.getByRole('status').textContent).toContain('This card hit an error');
    expect(onError.mock.calls[0]?.[0].message).toBe('chart broke');
  });

  it('renders the children again on a new reset key', () => {
    function Harness(): ReactElement {
      const [attempt, setAttempt] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setAttempt((current) => current + 1)}>retry</button>
          <CardBoundary resetKey={attempt}><Thrower fail={attempt === 0} /></CardBoundary>
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));

    expect(screen.getByText('chart')).toBeDefined();
  });

  it('hands a fallback function the error and a reset', () => {
    let fail = true;
    function Flaky(): ReactElement {
      return <Thrower fail={fail} />;
    }
    render(
      <CardBoundary fallback={(error, reset) => <button type="button" onClick={() => { fail = false; reset(); }}>{error.message}</button>}>
        <Flaky />
      </CardBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'chart broke' }));

    expect(screen.getByText('chart')).toBeDefined();
  });
});
