import type { CardSpec, TimeRange } from '../../contract/schemas.js';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';

import { ReportCard } from './ReportCard.js';

const CONFIG: CardSpec = { id: 'tokens', title: 'Tokens', range: 'last-week', chart: { primitive: 'bar' } };

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ReportCard', () => {
  it('asks its source for the config range and renders the answer', async () => {
    const source = mock(async (range: TimeRange | undefined) => `data for ${range}`);
    render(<ReportCard config={CONFIG} source={source}>{({ data }) => data}</ReportCard>);
    await flush();

    expect(screen.getByText('data for last-week')).toBeDefined();
  });

  it('edits the descriptor in the Config modal and asks again for a new range', async () => {
    const source = mock(async (range: TimeRange | undefined) => `data for ${range}`);
    const onConfigChange = mock<(next: CardSpec) => void>(() => undefined);
    render(<ReportCard config={CONFIG} source={source} onConfigChange={onConfigChange}>{({ data }) => data}</ReportCard>);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Options for Tokens' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Configure' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Yearly tokens' } });
    fireEvent.change(screen.getByLabelText('Range'), { target: { value: 'last-year' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await flush();

    expect(screen.getByRole('heading', { name: 'Yearly tokens' })).toBeDefined();
    expect(screen.getByText('data for last-year')).toBeDefined();
    expect(source.mock.calls.map((call) => call[0])).toEqual(['last-week', 'last-year']);
    expect(onConfigChange.mock.calls[0]?.[0]).toMatchObject({ id: 'tokens', title: 'Yearly tokens', range: 'last-year' });
  });
});
