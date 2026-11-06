import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';

import { CardModal } from './CardModal.js';

describe('CardModal', () => {
  it('renders a contained dialog named by its title, focused on Close', () => {
    render(<CardModal title="About" onClose={() => undefined}>body</CardModal>);
    const dialog = screen.getByRole('dialog', { name: 'About' });

    expect(dialog.tagName).toBe('DIV');
    expect(dialog.textContent).toContain('body');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('closes on Escape and on the close button', () => {
    const onClose = mock(() => undefined);
    render(<CardModal title="About" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('opens a native modal dialog for the page placement', () => {
    render(<CardModal title="Full size" placement="page" onClose={() => undefined}>chart</CardModal>);
    const dialog = screen.getByRole('dialog', { name: 'Full size' }) as HTMLDialogElement;

    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.open).toBe(true);
  });

  it('hands a page dialog its size and its header actions', () => {
    render(<CardModal title="Full size" placement="page" size="fit-70" actions={<button type="button">Legend</button>} onClose={() => undefined}>chart</CardModal>);
    const dialog = screen.getByRole('dialog', { name: 'Full size' });

    expect(dialog.className).toContain('max-w-[calc(100vw-30vmin)]');
    expect(screen.getByRole('button', { name: 'Legend' })).toBeDefined();
  });
});
