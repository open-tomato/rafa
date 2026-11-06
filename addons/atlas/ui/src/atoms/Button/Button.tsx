import type { ComponentProps, ReactElement } from 'react';

import { cn } from '@open-tomato/charts';

import { buttonVariants, type ButtonVariants } from './Button.variants.js';

/**
 * A button's props: the native button attributes, its variants and a
 * layout-only passthrough class. An `icon` button has no text, so it needs
 * an `aria-label`.
 */
export interface ButtonProps extends Omit<ComponentProps<'button'>, 'className'>, ButtonVariants {
  /** Layout context from the parent (alignment, margin); never colour or size. */
  readonly className?: string;
}

/** A native button in one of the card's shapes; `type` defaults to `button`, so it never submits by accident. */
export function Button({ variant, tone, className, type = 'button', ...rest }: ButtonProps): ReactElement {
  return (
    <button type={type} className={cn(buttonVariants({ variant, tone }), className)} {...rest} />
  );
}
