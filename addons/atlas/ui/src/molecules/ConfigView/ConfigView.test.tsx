import type { CardDescriptor } from '../../contract/schemas.js';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';

import { ConfigView } from './ConfigView.js';

describe('ConfigView', () => {
  it('starts from the descriptor and applies an edit', () => {
    const onSubmit = mock<(next: CardDescriptor) => void>(() => undefined);
    render(<ConfigView value={{ title: 'Tokens', range: 'now' }} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Tokens per day' } });
    fireEvent.change(screen.getByLabelText('Range'), { target: { value: 'last-year' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onSubmit).toHaveBeenCalledWith({ title: 'Tokens per day', range: 'last-year' });
  });

  it('refuses a blank title with the schema message', () => {
    const onSubmit = mock<(next: CardDescriptor) => void>(() => undefined);
    render(<ConfigView value={{ title: 'Tokens' }} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('A card needs a title.');
  });
});
