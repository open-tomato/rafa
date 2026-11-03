import type { Meta, StoryObj } from '@storybook/react-vite';

import { GRAPH_LINKS, GRAPH_NODES, LAYER_ORDER, LAYER_TONES } from '../fixtures.js';

import { Sankey } from './Sankey.js';

const meta = {
  title: 'Engine/Sankey',
  component: Sankey,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    ariaLabel: 'Imports flowing between layers',
    nodes: GRAPH_NODES,
    links: GRAPH_LINKS,
    groupTones: LAYER_TONES,
    groupOrder: LAYER_ORDER,
    height: 320,
    animate: false,
  },
} satisfies Meta<typeof Sankey>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
