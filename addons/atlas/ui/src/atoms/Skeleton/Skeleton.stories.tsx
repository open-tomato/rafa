import type { Meta, StoryObj } from '@storybook/react-vite';

import { Skeleton } from './Skeleton.js';

const meta = {
  title: 'Atoms/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Skeleton>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A bare shimmer line. */
export const Default: Story = { args: { width: 'half' } };
export const Block: Story = { args: { shape: 'block', height: 'value' } };
export const Circle: Story = { args: { shape: 'circle', width: 'fit', height: 'value' } };
/** Loading list rows: a disc, two lines and a pill. */
export const ListRows: Story = {
  render: () => (
    <div className="flex w-[420px] flex-col gap-3.5">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton shape="circle" width="fit" height="value" className="shrink-0" />
          <div className="flex flex-1 flex-col gap-[7px]">
            <Skeleton width="half" />
            <Skeleton width="wide" />
          </div>
          <Skeleton shape="block" width="short" height="title" className="max-w-[54px]" />
        </div>
      ))}
    </div>
  ),
};
