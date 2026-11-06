import { cva, type VariantProps } from 'class-variance-authority';

/**
 * A tinted square or circle holding one icon: a method card's tile, a
 * next-step row's glyph, a confirmation screen's status circle. Every
 * tone tints at 14%.
 */
export const iconTileVariants: (props?: IconTileVariantProps) => string = cva(
  'relative inline-flex shrink-0 items-center justify-center',
  {
    variants: {
      tone: {
        accent: 'bg-series-1/14 text-series-1',
        good: 'bg-good/14 text-good',
        critical: 'bg-critical/14 text-critical',
        neutral: 'bg-ink-2/14 text-ink-2',
      },
      size: {
        sm: 'size-7',
        md: 'size-9',
        lg: 'size-16',
        xl: 'size-[72px]',
        '2xl': 'size-20',
      },
      shape: {
        rounded: '',
        circle: 'rounded-full',
      },
    },
    compoundVariants: [
      { shape: 'rounded', size: 'sm', class: 'rounded-sm' },
      { shape: 'rounded', size: 'md', class: 'rounded-md' },
      { shape: 'rounded', size: 'lg', class: 'rounded-lg' },
      { shape: 'rounded', size: 'xl', class: 'rounded-lg' },
      { shape: 'rounded', size: '2xl', class: 'rounded-lg' },
    ],
    defaultVariants: { tone: 'accent', size: 'md', shape: 'rounded' },
  },
);

/** The pulsing ring around a live tile; still under reduced motion. */
export const iconTileRingVariants: (props?: Record<string, never>) => string = cva(
  '-inset-1.5 absolute rounded-full border-2 border-current opacity-35 motion-safe:animate-pulse-ring',
);

/** The tile's tone. */
export type IconTileTone = 'accent' | 'good' | 'critical' | 'neutral';

/** The tile's size. */
export type IconTileSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

/** The tile's shape. */
export type IconTileShape = 'rounded' | 'circle';

/** The variant props `iconTileVariants` takes. */
export interface IconTileVariantProps {
  readonly tone?: IconTileTone | null;
  readonly size?: IconTileSize | null;
  readonly shape?: IconTileShape | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type IconTileVariants = VariantProps<typeof iconTileVariants>;
