import type { ReactElement, ReactNode } from 'react';

import { cva } from 'class-variance-authority';

/**
 * Story-only fillers: the tiles the layout atoms' stories arrange, and
 * the text-block rows a card story holds. Never exported from the
 * library barrel and never imported by a component; `tsconfig.json`
 * leaves this folder out, and `tsconfig.stories.json` checks it.
 */

/** A placeholder pill: a rounded bar in the baseline tone. */
const placeholderVariants: (props?: PlaceholderVariantProps) => string = cva('block rounded-full bg-baseline opacity-50', {
  variants: {
    width: {
      full: 'w-full',
      wide: 'w-[85%]',
      mid: 'w-[70%]',
    },
    height: {
      text: 'h-[12px]',
      line: 'h-[9px]',
    },
    ink: {
      true: 'bg-ink-2',
      false: '',
    },
  },
  defaultVariants: { width: 'full', height: 'line', ink: false },
});

interface PlaceholderVariantProps {
  readonly width?: 'full' | 'wide' | 'mid' | null;
  readonly height?: 'text' | 'line' | null;
  readonly ink?: boolean | null;
}

/** The text-block rows rendered inside a card story. */
export function CardFiller(): ReactElement {
  return (
    <span className={fillerVariants()}>
      <span className={placeholderVariants({ width: 'mid', height: 'text', ink: true })} />
      <span className={placeholderVariants({ width: 'full' })} />
      <span className={placeholderVariants({ width: 'wide' })} />
    </span>
  );
}

const fillerVariants: (props?: Record<string, never>) => string = cva('flex flex-col gap-2');

/** The numbered neutral tiles a grid story arranges. */
const gridTileVariants: (props?: Record<string, never>) => string = cva(
  'flex h-[56px] items-center justify-center rounded-md border border-grid bg-surface font-mono text-xs text-muted',
);

/** `count` numbered tiles for a `Grid` story. */
export function GridTiles({ count = 6 }: { readonly count?: number }): ReactNode {
  return Array.from({ length: count }, (_, index) => (
    <span key={index} className={gridTileVariants()}>{index + 1}</span>
  ));
}

/** The highlighted tile a `GridItem` story spans with. */
const spanTileVariants: (props?: Record<string, never>) => string = cva(
  'flex h-[56px] items-center justify-center rounded-md border border-series-1/45 bg-series-1/15 font-mono text-xs font-semibold text-series-1',
);

/** The labelled, tinted tile a `GridItem` story places. */
export function SpanTile({ label }: { readonly label: string }): ReactElement {
  return <span className={spanTileVariants()}>{label}</span>;
}

/** The tinted `item N` tiles a `Content` story arranges, in three tones. */
const contentTileVariants: (props?: ContentTileVariantProps) => string = cva(
  'whitespace-nowrap rounded-md border px-4 py-3 font-mono text-[13px] font-semibold',
  {
    variants: {
      tone: {
        '0': 'border-series-1/40 bg-series-1/15 text-series-1',
        '1': 'border-series-3/40 bg-series-3/15 text-series-3',
        '2': 'border-series-4/40 bg-series-4/15 text-series-4',
      },
    },
    defaultVariants: { tone: '0' },
  },
);

interface ContentTileVariantProps {
  readonly tone?: '0' | '1' | '2' | null;
}

/** The tile tones, cycled. */
const CONTENT_TONES = ['0', '1', '2'] as const;

/** `count` tinted tiles for a `Content` story. */
export function ContentTiles({ count = 3 }: { readonly count?: number }): ReactNode {
  return Array.from({ length: count }, (_, index) => (
    <span key={index} className={contentTileVariants({ tone: CONTENT_TONES[index % CONTENT_TONES.length] })}>
      item {index + 1}
    </span>
  ));
}
