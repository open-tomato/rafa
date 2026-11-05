import type { Meta, StoryObj } from '@storybook/react-vite';

import { HEAT_CELLS, HEAT_COLS, HEAT_ROWS } from '../fixtures.js';

import { HeatmapGrid } from './HeatmapGrid.js';

const meta = {
  title: 'Engine/HeatmapGrid',
  component: HeatmapGrid,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    ariaLabel: 'Preflight halts by weekday and week',
    rows: HEAT_ROWS,
    cols: HEAT_COLS,
    cells: HEAT_CELLS,
    unit: 'halts',
    height: 260,
    animate: false,
  },
} satisfies Meta<typeof HeatmapGrid>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Selected: Story = { args: { selected: { row: 2, col: 5 }, onCellClick: () => undefined } };
