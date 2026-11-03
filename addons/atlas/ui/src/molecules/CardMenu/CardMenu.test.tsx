import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';
import { Info, Table2 } from 'lucide-react';

import { CardMenu } from './CardMenu.js';

function items(onInfo = (): void => undefined): Parameters<typeof CardMenu>[0]['items'] {
  return [
    { key: 'info', label: 'Info', icon: Info, onSelect: onInfo },
    { key: 'source', label: 'Source', icon: Table2, onSelect: () => undefined },
  ];
}

describe('CardMenu', () => {
  it('opens a menu from the trigger and focuses the first entry', () => {
    render(<CardMenu items={items()} label="Options" />);
    const trigger = screen.getByRole('button', { name: 'Options' });

    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('menuitem').map((entry) => entry.textContent)).toEqual(['Info', 'Source']);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Info' }));
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render(<CardMenu items={items()} label="Options" />);
    const trigger = screen.getByRole('button', { name: 'Options' });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a pointer down outside', () => {
    render(<><CardMenu items={items()} label="Options" /><p>outside</p></>);
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    fireEvent.pointerDown(screen.getByText('outside'));

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('runs the picked entry and closes', () => {
    const onInfo = mock(() => undefined);
    render(<CardMenu items={items(onInfo)} label="Options" />);
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Info' }));

    expect(onInfo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('moves focus with the arrow keys, wrapping', () => {
    render(<CardMenu items={items()} label="Options" />);
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });

    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Source' }));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Info' }));
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Source' }));
  });
});
