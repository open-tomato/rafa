import type { Meta, StoryObj } from '@storybook/react-vite';

import { SUNBURST_NODES, SUNBURST_TONES } from '../fixtures.js';

import { Sunburst } from './Sunburst.js';

const meta = {
  title: 'Engine/Sunburst',
  component: Sunburst,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    ariaLabel: 'What each package is made of',
    nodes: SUNBURST_NODES,
    groupTones: SUNBURST_TONES,
    unit: 'lines',
    height: 320,
    animate: false,
  },
} satisfies Meta<typeof Sunburst>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Clickable: Story = { args: { onNodeClick: () => undefined } };
