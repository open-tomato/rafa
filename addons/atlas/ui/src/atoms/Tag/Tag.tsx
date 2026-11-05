import type { ReactElement, ReactNode } from 'react';

import { cn } from '@open-tomato/charts';

import { tagVariants, type TagVariants } from './Tag.variants.js';

/** A tag's props: its tone, the face, a leading icon, the children and a layout-only passthrough class. */
export interface TagProps extends TagVariants {
  /** A leading 13px icon. */
  readonly icon?: ReactNode;
  readonly children?: ReactNode;
  /** Layout context from the parent (margin, alignment); never colour or size. */
  readonly className?: string;
}

/** A classification label; the body face whenever an icon leads, unless `mono` says otherwise. */
export function Tag({ tone, mono, icon, children, className }: TagProps): ReactElement {
  return (
    <span className={cn(tagVariants({ tone, mono: mono ?? icon === undefined }), className)}>
      {icon}
      {children}
    </span>
  );
}
