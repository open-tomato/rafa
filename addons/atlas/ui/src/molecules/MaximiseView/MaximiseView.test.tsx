import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';

import { MaximiseView } from './MaximiseView.js';

const LEGEND = <ul aria-label="Legend"><li>input</li><li>output</li></ul>;
const TABLE = <table aria-label="Tokens"><tbody><tr><td>120</td></tr></tbody></table>;

/** The maximise dialog, by the card's title. */
function box(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Tokens' });
}

describe('MaximiseView', () => {
  it('opens an 80/20 square titled by the card, the content told to fill it', () => {
    render(<MaximiseView title="Tokens" onClose={() => undefined}>{({ height }) => <p>chart height={height}</p>}</MaximiseView>);

    expect(box().tagName).toBe('DIALOG');
    expect(box().className).toContain('w-[80vmin]');
    expect(screen.getByRole('radio', { name: '80/20' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('chart height=fill')).toBeDefined();
  });

  it('resizes the box when another combo is picked', () => {
    render(<MaximiseView title="Tokens" onClose={() => undefined}>chart</MaximiseView>);
    fireEvent.click(screen.getByRole('radio', { name: '70/30' }));

    expect(box().className).toContain('h-[70vmin]');
    expect(box().className).not.toContain('80vmin');
    fireEvent.click(screen.getByRole('radio', { name: '90/10' }));
    expect(box().className).toContain('w-[90vmin]');
  });

  it('names the combo control for assistive technology', () => {
    render(<MaximiseView title="Tokens" onClose={() => undefined}>chart</MaximiseView>);

    expect(screen.getByRole('radiogroup', { name: 'Box size: stretch and clearance' })).toBeDefined();
  });

  it('shows and hides the legend and the table from their toggles, both off at first', () => {
    render(<MaximiseView title="Tokens" onClose={() => undefined} legend={LEGEND} table={TABLE}>chart</MaximiseView>);
    const legendToggle = screen.getByRole('button', { name: 'Legend' });
    const tableToggle = screen.getByRole('button', { name: 'Table' });

    expect(legendToggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
    expect(screen.queryByRole('table', { name: 'Tokens' })).toBeNull();

    fireEvent.click(legendToggle);
    fireEvent.click(tableToggle);
    expect(legendToggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('list', { name: 'Legend' })).toBeDefined();
    expect(screen.getByRole('table', { name: 'Tokens' })).toBeDefined();

    fireEvent.click(legendToggle);
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
    expect(screen.getByRole('table', { name: 'Tokens' })).toBeDefined();
  });

  it('leaves out the toggle of an extra the card does not have', () => {
    render(<MaximiseView title="Tokens" onClose={() => undefined} legend={LEGEND}>chart</MaximiseView>);

    expect(screen.getByRole('button', { name: 'Legend' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
  });

  it('calls onClose from Close', () => {
    const onClose = mock(() => undefined);
    render(<MaximiseView title="Tokens" onClose={onClose}>chart</MaximiseView>);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });
});
