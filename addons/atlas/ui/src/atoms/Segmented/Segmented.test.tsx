import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';
import { useState, type ReactElement } from 'react';

import { Segmented } from './Segmented.js';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

function Controlled(): ReactElement {
  const [value, setValue] = useState('a');
  return <Segmented value={value} options={OPTIONS} onChange={setValue} label="Pick" />;
}

describe('Segmented', () => {
  it('renders a radio group with the value checked', () => {
    render(<Segmented value="b" options={OPTIONS} onChange={() => undefined} label="Pick" />);

    expect(screen.getByRole('radiogroup', { name: 'Pick' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Beta' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Alpha' }).getAttribute('tabindex')).toBe('-1');
  });

  it('calls onChange with the clicked value', () => {
    const onChange = mock<(value: string) => void>(() => undefined);
    render(<Segmented value="a" options={OPTIONS} onChange={onChange} label="Pick" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Gamma' }));

    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('moves the choice with the arrow keys, wrapping at the ends', () => {
    render(<Controlled />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Alpha' }), { key: 'ArrowLeft' });

    expect(screen.getByRole('radio', { name: 'Gamma' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Gamma' }), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Alpha' }).getAttribute('aria-checked')).toBe('true');
  });
});
