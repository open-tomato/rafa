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

  it('sizes a fit dialog by its content, capped at the clearance on both sides', () => {
    render(<Dialog open title="Indices" size="fit-70" onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'Indices' });

    expect(dialog.className).toContain('w-fit');
    expect(dialog.className).toContain('max-w-[calc(100vw-30vmin)]');
    expect(dialog.className).toContain('max-h-[calc(100vh-30vmin)]');
    expect(dialog.className).not.toContain('vmin]');
  });

  it('scrolls its body on a thin scrollbar in the baseline tone', () => {
    render(<Dialog open title="Indices" onClose={() => undefined}><p>body</p></Dialog>);

    expect(screen.getByText('body').parentElement?.className).toContain('[scrollbar-width:thin]');
    expect(screen.getByText('body').parentElement?.className).toContain('var(--color-baseline)');
  });

  it('puts its actions in the header, before Close', () => {
    render(<Dialog open title="Indices" actions={<button type="button">Table</button>} onClose={() => undefined} />);
    const names = screen.getAllByRole('button').map((button) => button.textContent === ''
      ? button.getAttribute('aria-label')
      : button.textContent);

    expect(names).toEqual(['Table', 'Close']);
  });
});
