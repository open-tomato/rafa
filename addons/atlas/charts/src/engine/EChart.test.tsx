import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { EChart } from './shared.js';

/** happy-dom has no layout, so ECharts warns that the host has no size; the tests do not draw. */
let warn: ReturnType<typeof spyOn>;

beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('EChart', () => {
  it('renders an image role named by its label, as high as asked', () => {
    render(<EChart option={{}} ariaLabel="Empty chart" height={180} />);

    expect(screen.getByRole('img', { name: 'Empty chart' }).style.height).toBe('180px');
  });

  it('defaults to 220px', () => {
    render(<EChart option={{}} ariaLabel="Default height" />);

    expect(screen.getByRole('img', { name: 'Default height' }).style.height).toBe('220px');
  });

  it('follows a new height', () => {
    const { rerender } = render(<EChart option={{}} ariaLabel="Growing" height={100} />);
    rerender(<EChart option={{}} ariaLabel="Growing" height={140} />);

    expect(screen.getByRole('img', { name: 'Growing' }).style.height).toBe('140px');
  });

  it('fills its container\'s height for fill', () => {
    render(<EChart option={{}} ariaLabel="Filling" height="fill" />);

    expect(screen.getByRole('img', { name: 'Filling' }).style.height).toBe('100%');
  });

  it('is as wide as its container and merges the passthrough class last', () => {
    render(<EChart option={{}} ariaLabel="Wide" className="mt-2" />);
    const root = screen.getByRole('img', { name: 'Wide' });

    expect(root.className).toContain('w-full');
    expect(root.className.endsWith('mt-2')).toBe(true);
  });

  it('keeps the arrow over marks that are not buttons', () => {
    render(<EChart option={{}} ariaLabel="Plain" cursor="default" />);

    expect(screen.getByRole('img', { name: 'Plain' }).className).toContain('cursor-default');
  });
});
