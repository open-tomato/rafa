import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The card's buttons: a square icon button (the menu trigger, a modal's
 * close), an outlined text button (Try again, a picker, a toggle that is
 * filled while `aria-pressed`), a menu item that fills its row, and a solid
 * primary action (a form's Apply).
 */
export const buttonVariants: (props?: ButtonVariantProps) => string = cva(
  'inline-flex shrink-0 items-center gap-1.5 rounded-md text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-series-1 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        icon: 'justify-center p-1 hover:bg-grid/60',
        text: 'justify-center px-2 py-0.5 ring-1 ring-ring hover:bg-grid/60 aria-pressed:bg-grid aria-pressed:text-ink',
        menuitem: 'w-full justify-start px-2 py-1.5 text-left hover:bg-grid/60 focus-visible:bg-grid/60',
        primary: 'justify-center bg-ink px-2.5 py-1 font-medium text-surface hover:bg-ink-2',
      },
      tone: {
        default: '',
        critical: 'text-critical',
      },
    },
    compoundVariants: [
      { variant: ['icon', 'text'], tone: 'default', class: 'text-ink-2 hover:text-ink' },
      { variant: 'menuitem', tone: 'default', class: 'text-ink' },
    ],
    defaultVariants: { variant: 'text', tone: 'default' },
  },
);

/** The button's shape. */
export type ButtonVariant = 'icon' | 'text' | 'menuitem' | 'primary';

/** The button's text tone: default ink, or critical for the Errors entry. */
export type ButtonTone = 'default' | 'critical';

/** The variant props `buttonVariants` takes. */
export interface ButtonVariantProps {
  readonly variant?: ButtonVariant | null;
  readonly tone?: ButtonTone | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type ButtonVariants = VariantProps<typeof buttonVariants>;
