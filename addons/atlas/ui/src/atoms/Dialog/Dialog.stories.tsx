import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../Button/Button.js';

import { Dialog } from './Dialog.js';

const meta = {
  title: 'Atoms/Dialog',
  component: Dialog,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: {
    open: true,
    title: 'Indices on the balance radar',
    onClose: () => undefined,
    children: <p>Up to four indices per pole; the last one on a pole stays on.</p>,
  },
} satisfies Meta<typeof Dialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Medium: Story = { args: { size: 'md' } };
export const Large: Story = { args: { size: 'lg' } };
export const Full: Story = { args: { size: 'full' } };
export const Fit70: Story = { args: { size: 'fit-70' } };
export const Fit90: Story = { args: { size: 'fit-90' } };
export const WithActions: Story = { args: { size: 'lg', actions: <Button variant="text">Table</Button> } };
