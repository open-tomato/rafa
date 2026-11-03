import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Star } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { CardLayout } from './CardLayout.js';
import { isModalDefinition, labelOfKey, orderModalKeys, resolveModal, resolveModals } from './registry.js';

const originalError = console.error;

function openMenu(title = 'Tokens'): void {
  fireEvent.click(screen.getByRole('button', { name: `Options for ${title}` }));
}

function menuLabels(): string[] {
  return screen.getAllByRole('menuitem').map((entry) => entry.textContent ?? '');
}

describe('the modal registry', () => {
  it('orders built-ins around the consumer keys', () => {
    expect(orderModalKeys(['errors', 'custom', 'maximise', 'source', 'info'])).toEqual(['info', 'source', 'custom', 'maximise', 'errors']);
  });

  it('tells a definition from content and components', () => {
    expect(isModalDefinition({ render: 'x' })).toBe(true);
    expect(isModalDefinition(<p>x</p>)).toBe(false);
    expect(isModalDefinition('text')).toBe(false);
    expect(isModalDefinition(() => null)).toBe(false);
  });

  it('fills built-in defaults, card titles and consumer labels', () => {
    expect(resolveModal('info', 'body', 'Tokens')).toMatchObject({ label: 'Info', title: 'Tokens', chrome: true, placement: 'contained' });
    expect(resolveModal('maximise', 'body', 'Tokens')).toMatchObject({ label: 'Maximise', placement: 'page' });
    expect(resolveModal('errors', 'body', 'Tokens')).toMatchObject({ tone: 'critical' });
    expect(resolveModal('top-models', () => null, 'Tokens')).toMatchObject({ label: 'Top models', chrome: false });
    expect(resolveModal('pick', { label: 'Pick…', icon: Star, render: 'x' }, 'T')).toMatchObject({ label: 'Pick…', icon: Star, title: 'Pick…' });
    expect(labelOfKey('a_b-c')).toBe('A b c');
  });

  it('leaves out absent entries', () => {
    expect(resolveModals({ info: 'x', source: false, extra: null }, 'T').map((modal) => modal.key)).toEqual(['info']);
  });
});

describe('CardLayout', () => {
  beforeEach(() => {
    console.error = () => undefined;
  });

  afterEach(() => {
    console.error = originalError;
  });

  it('renders the slots in a region named by the title', () => {
    render(<CardLayout title="Tokens" content={<p>chart</p>} footer="Updated hourly" />);
    const card = screen.getByRole('region', { name: 'Tokens' });

    expect(within(card).getByRole('heading', { name: 'Tokens' })).toBeDefined();
    expect(within(card).getByText('chart')).toBeDefined();
    expect(within(card).getByText('Updated hourly')).toBeDefined();
    expect(within(card).queryByRole('button', { name: 'Options for Tokens' })).toBeNull();
  });

  it('lists every entry in the menu and opens it in the default chrome', () => {
    render(<CardLayout title="Tokens" content="chart" modals={{ info: <p>how to read</p>, source: <p>the table</p>, notes: <p>my notes</p> }} />);
    openMenu();

    expect(menuLabels()).toEqual(['Info', 'Source', 'Notes']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Source' }));
    expect(screen.getByRole('dialog', { name: 'Source' }).textContent).toContain('the table');
  });

  it('switches the modal content between registry entries and closes on Escape', () => {
    render(<CardLayout title="Tokens" content="chart" modals={{ info: <p>how to read</p>, source: <p>the table</p> }} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Info' }));

    expect(screen.getByRole('dialog', { name: 'Tokens' }).textContent).toContain('how to read');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Source' }));
    expect(screen.getByRole('dialog', { name: 'Source' }).textContent).toContain('the table');
    expect(screen.queryByText('how to read')).toBeNull();
  });

  it('hands a component entry close and the card, and lets it own its chrome', () => {
    render(
      <CardLayout
        title="Tokens"
        content="chart"
        modals={{ picker: ({ close, card }) => <button type="button" onClick={close}>{`Close picker of ${card.title}`}</button> }}
      />,
    );
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Picker' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close picker of Tokens' }));
    expect(screen.queryByRole('button', { name: 'Close picker of Tokens' })).toBeNull();
  });

  it('keeps a component entry\'s state across the layout\'s re-renders', () => {
    function Counter(): ReactElement {
      const [count, setCount] = useState(0);
      return <button type="button" onClick={() => setCount((current) => current + 1)}>{`count ${count}`}</button>;
    }
    function Harness(): ReactElement {
      const [ticks, setTicks] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setTicks((current) => current + 1)}>tick</button>
          <CardLayout title="Tokens" content={`tick ${ticks}`} modals={{ counter: () => <Counter /> }} />
        </>
      );
    }
    render(<Harness />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Counter' }));
    fireEvent.click(screen.getByRole('button', { name: 'count 0' }));
    fireEvent.click(screen.getByRole('button', { name: 'tick' }));

    expect(screen.getByRole('button', { name: 'count 1' })).toBeDefined();
  });

  it('catches a throwing child, lists Errors, and Try again renders the child again', () => {
    let fail = true;
    function Chart(): ReactElement {
      if (fail) throw new Error('chart broke');
      return <p>chart</p>;
    }
    const onError = mock<(error: Error) => void>(() => undefined);
    const onRetry = mock(() => undefined);
    render(<CardLayout title="Tokens" content={<Chart />} modals={{ info: 'about' }} onError={onError} onRetry={onRetry} />);

    expect(screen.getByRole('status').textContent).toContain('This card hit an error');
    expect(onError).toHaveBeenCalledTimes(1);
    openMenu();
    expect(menuLabels()).toEqual(['Info', 'Errors']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Errors' }));
    expect(screen.getByRole('dialog', { name: 'Errors' }).textContent).toContain('Error: chart broke');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('chart')).toBeDefined();
    expect(onRetry).toHaveBeenCalledTimes(1);
    openMenu();
    expect(menuLabels()).toEqual(['Info']);
  });

  it('lists Errors for an error handed in from the data layer', () => {
    render(<CardLayout title="Tokens" content="stale chart" error={new Error('offline')} />);
    openMenu();

    expect(menuLabels()).toEqual(['Errors']);
  });

  it('re-renders the content at full size in a page dialog for maximise', () => {
    render(<CardLayout title="Tokens" maximisable content={({ maximised }) => <p>{maximised
      ? 'big chart'
      : 'small chart'}</p>} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Maximise' }));
    const dialog = screen.getByRole('dialog', { name: 'Tokens' });

    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.textContent).toContain('big chart');
    expect(screen.getByText('small chart')).toBeDefined();
  });

  it('opens the maximise entry as an 80/20 square with the extras behind toggles', () => {
    render(<CardLayout title="Tokens" maximisable maximiseExtras={{ table: <p>the table</p> }} content={({ height }) => <p>{`height=${String(height)}`}</p>} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Maximise' }));
    const dialog = screen.getByRole('dialog', { name: 'Tokens' });

    expect(dialog.className).toContain('w-[80vmin]');
    expect(dialog.textContent).toContain('height=fill');
    expect(screen.getByText('height=220')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Legend' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(dialog.textContent).toContain('the table');
  });

  it('drops the menu when told to', () => {
    render(<CardLayout title="Tokens" content="chart" menu={null} modals={{ info: 'about' }} />);

    expect(screen.queryByRole('button', { name: 'Options for Tokens' })).toBeNull();
  });
});
