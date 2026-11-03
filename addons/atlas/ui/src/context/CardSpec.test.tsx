import type { CardSpec } from '../contract/schemas.js';
import type { ReactElement } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';

import { CardSpecProvider, useCardSpec } from './CardSpec.js';

const CONFIG: CardSpec = { id: 'tokens', title: 'Tokens', chart: { primitive: 'line' } };

function Title(): ReactElement {
  const { config, update } = useCardSpec();
  return <button type="button" onClick={() => update({ ...config, title: 'Renamed' })}>{config.title}</button>;
}

describe('CardSpecProvider', () => {
  it('provides the descriptor and keeps an edit when uncontrolled', () => {
    render(<CardSpecProvider value={CONFIG}><Title /></CardSpecProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Tokens' }));

    expect(screen.getByRole('button', { name: 'Renamed' })).toBeDefined();
  });

  it('hands an edit to onChange and shows the value it is given when controlled', () => {
    const onChange = mock<(next: CardSpec) => void>(() => undefined);
    render(<CardSpecProvider value={CONFIG} onChange={onChange}><Title /></CardSpecProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Tokens' }));

    expect(onChange).toHaveBeenCalledWith({ ...CONFIG, title: 'Renamed' });
    expect(screen.getByRole('button', { name: 'Tokens' })).toBeDefined();
  });
});
