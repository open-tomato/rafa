import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';

import { Dialog } from './Dialog.js';

describe('Dialog', () => {
  it('opens as a modal named by its title', () => {
    render(<Dialog open title="Indices" onClose={() => undefined}>body</Dialog>);
    const dialog = screen.getByRole('dialog', { name: 'Indices' }) as HTMLDialogElement;

    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('body');
  });

  it('closes the element when open turns false', () => {
    const { rerender } = render(<Dialog open title="Indices" onClose={() => undefined} />);
    rerender(<Dialog open={false} title="Indices" onClose={() => undefined} />);

    expect((document.querySelector('dialog') as HTMLDialogElement).open).toBe(false);
  });

  it('calls onClose from the close button', () => {
    const onClose = mock(() => undefined);
    render(<Dialog open title="Indices" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('draws a fit size as a square of the viewport\'s smaller side, with no cap', () => {
    render(<Dialog open title="Indices" size="fit-80" onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'Indices' });

    expect(dialog.className).toContain('w-[80vmin]');
    expect(dialog.className).toContain('h-[80vmin]');
    expect(dialog.className).toContain('max-w-none');
    expect(dialog.className).not.toContain('max-h-[calc');
  });

  it('puts its actions in the header, before Close', () => {
    render(<Dialog open title="Indices" actions={<button type="button">Table</button>} onClose={() => undefined} />);
    const names = screen.getAllByRole('button').map((button) => button.textContent === ''
      ? button.getAttribute('aria-label')
      : button.textContent);

    expect(names).toEqual(['Table', 'Close']);
  });
});
