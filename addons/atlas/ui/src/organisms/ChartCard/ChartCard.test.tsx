import type { LegendItem } from '../../context/types.js';
import type { CardSpec } from '../../contract/schemas.js';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';

import { CardData } from '../../context/CardData.js';

import { ChartCard, type ChartRenderArgs } from './ChartCard.js';
import { relabel } from './entries.js';

interface Tokens {
  readonly input: number;
  readonly output: number;
}

const CONFIG: CardSpec = {
  id: 'tokens',
  title: 'Tokens',
  subtitle: 'per day',
  description: 'Input and output tokens per day.',
  source: 'Fixed sample',
  chart: { primitive: 'bar' },
  legend: { toggleable: true },
};

const LEGEND: readonly LegendItem[] = [
  { id: 'input', label: 'Input', tone: 'series-1' },
  { id: 'output', label: 'Output', tone: 'series-2' },
];

const DATA: Tokens = { input: 120, output: 40 };

function chart({ data, hidden, animate, maximised }: ChartRenderArgs<Tokens>): string {
  const shown = (['input', 'output'] as const).filter((id) => !hidden.has(id)).map((id) => `${id}=${data[id]}`);
  return `${shown.join(',')}|animate=${String(animate)}|max=${String(maximised)}`;
}

function openMenu(title = 'Tokens'): void {
  fireEvent.click(screen.getByRole('button', { name: `Options for ${title}` }));
}

function menuLabels(): string[] {
  return screen.getAllByRole('menuitem').map((entry) => entry.textContent ?? '');
}

describe('relabel', () => {
  it('puts a menu item\'s label on content, components and definitions', () => {
    expect(relabel('body', { key: 'info', label: 'About' })).toEqual({ render: 'body', chrome: true, label: 'About' });
    expect(relabel(false, { key: 'info', label: 'About' })).toBe(false);
    expect(relabel('body', undefined)).toBe('body');
  });
});

describe('ChartCard', () => {
  it('renders the header and hands the chart its data, the hidden set and animation', () => {
    render(<ChartCard config={CONFIG} data={DATA} legend={LEGEND}>{chart}</ChartCard>);

    expect(screen.getByRole('heading', { name: 'Tokens' })).toBeDefined();
    expect(screen.getByText('input=120,output=40|animate=true|max=false')).toBeDefined();
  });

  it('hides a series from the legend toggle', () => {
    render(<ChartCard config={CONFIG} data={DATA} legend={LEGEND}>{chart}</ChartCard>);
    fireEvent.click(screen.getByRole('button', { name: 'Output' }));

    expect(screen.getByText('input=120|animate=true|max=false')).toBeDefined();
  });

  it('offers Info, Source and Maximise, and shows the description and the table', () => {
    render(<ChartCard config={CONFIG} data={DATA} legend={LEGEND} table={(data) => ({ columns: ['Kind', 'Tokens'], rows: [['input', data.input]] })}>{chart}</ChartCard>);
    openMenu();

    expect(menuLabels()).toEqual(['Info', 'Source', 'Maximise']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Info' }));
    expect(screen.getByRole('dialog', { name: 'Tokens' }).textContent).toContain('Input and output tokens per day.');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Source' }));
    expect(screen.getByRole('table', { name: 'Tokens' })).toBeDefined();
  });

  it('renders the chart maximised in the maximise entry', () => {
    render(<ChartCard config={CONFIG} data={DATA}>{chart}</ChartCard>);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Maximise' }));

    expect(screen.getByText('input=120,output=40|animate=true|max=true')).toBeDefined();
  });

  it('hands the chart fill when maximised and the default px in the card', () => {
    render(<ChartCard config={CONFIG} data={DATA}>{({ maximised, height }) => `max=${String(maximised)}|height=${String(height)}`}</ChartCard>);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Maximise' }));

    expect(screen.getByText('max=false|height=220')).toBeDefined();
    expect(screen.getByText('max=true|height=fill')).toBeDefined();
  });

  it('moves the legend and the source table under the maximise toggles', () => {
    const table = { columns: ['Kind', 'Tokens'], rows: [['input', 120], ['output', 40]] };
    render(<ChartCard config={CONFIG} data={DATA} legend={LEGEND} table={table}>{chart}</ChartCard>);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Maximise' }));
    const dialog = screen.getByRole('dialog', { name: 'Tokens' });
    const inDialog = (role: string): number => [...dialog.querySelectorAll(role)].length;

    expect(inDialog('ul')).toBe(0);
    expect(inDialog('table')).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Legend' }));
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(inDialog('ul')).toBe(1);
    expect(inDialog('table')).toBe(1);
  });

  it('opens the maximise entry as the config says: large, the legend always on, the table behind a toggle that starts on', () => {
    const table = { columns: ['Kind', 'Tokens'], rows: [['input', 120], ['output', 40]] };
    const config = { ...CONFIG, maximise: { size: 'large' as const, legend: 'always' as const, table: 'toggle-on' as const } };
    render(<ChartCard config={config} data={DATA} legend={LEGEND} table={table}>{chart}</ChartCard>);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Maximise' }));
    const dialog = screen.getByRole('dialog', { name: 'Tokens' });

    expect(screen.getByRole('radio', { name: 'Large' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Legend' })).toBeNull();
    expect([...dialog.querySelectorAll('ul')].length).toBe(1);
    expect(screen.getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('true');
    expect([...dialog.querySelectorAll('table')].length).toBe(1);
  });

  it('offers no Table toggle when the card has no table', () => {
    render(<ChartCard config={CONFIG} data={DATA} legend={LEGEND}>{chart}</ChartCard>);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Maximise' }));

    expect(screen.getByRole('button', { name: 'Legend' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
  });

  it('narrows the built-ins to config.modals and relabels them from config.menu', () => {
    render(<ChartCard config={{ ...CONFIG, modals: ['info'], menu: [{ key: 'info', label: 'How to read' }] }} data={DATA}>{chart}</ChartCard>);
    openMenu();

    expect(menuLabels()).toEqual(['How to read']);
  });

  it('edits the descriptor from the Config entry', () => {
    render(<ChartCard config={CONFIG} data={DATA} configurable>{chart}</ChartCard>);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Configure' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Tokens per day' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('heading', { name: 'Tokens per day' })).toBeDefined();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('drops the menu, toggles and animation when not interactive', () => {
    render(<ChartCard config={CONFIG} data={DATA} legend={LEGEND} interactive={false}>{chart}</ChartCard>);

    expect(screen.queryByRole('button', { name: 'Options for Tokens' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Output' })).toBeNull();
    expect(screen.getByText('input=120,output=40|animate=false|max=false')).toBeDefined();
  });

  it('reads an enclosing CardData, shows loading, and retries a failed source', async () => {
    let calls = 0;
    const source = mock(async (): Promise<Tokens> => {
      calls += 1;
      if (calls === 1) throw new Error('offline');
      return DATA;
    });
    render(<CardData source={source}><ChartCard config={CONFIG}>{chart}</ChartCard></CardData>);

    expect(screen.getByRole('status').textContent).toContain('Loading');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('status').textContent).toContain('This card hit an error');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Errors' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('input=120,output=40|animate=true|max=false')).toBeDefined();
    expect(source).toHaveBeenCalledTimes(2);
  });

  it('catches a throwing chart and lists Errors', () => {
    const original = console.error;
    console.error = () => undefined;
    try {
      render(<ChartCard config={CONFIG} data={DATA}>{() => {
        throw new Error('bad option');
      }}</ChartCard>);
      openMenu();

      expect(menuLabels()).toContain('Errors');
    } finally {
      console.error = original;
    }
  });
});
