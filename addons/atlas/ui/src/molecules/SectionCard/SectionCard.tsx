import type { ReactElement, ReactNode } from 'react';

import { cn } from '@open-tomato/charts';

import {
  sectionCardActionVariants,
  sectionCardBodyVariants,
  sectionCardFooterVariants,
  sectionCardHeaderVariants,
  sectionCardSubtitleVariants,
  sectionCardTitleVariants,
  sectionCardVariants,
  type SectionCardBodyVariants,
} from './SectionCard.variants.js';

/** A section card's props: the header texts and slot, the footer line, the body padding and the children. */
export interface SectionCardProps extends SectionCardBodyVariants {
  /** The header title; the header row renders when a title or an action is given. */
  readonly title?: string;
  /** A small greyed line under the title. */
  readonly subtitle?: ReactNode;
  /** The right side of the header: filters, a legend, buttons. */
  readonly action?: ReactNode;
  /** A small footer line under the body. */
  readonly footer?: ReactNode;
  /** A rule above the footer line. */
  readonly footerDivider?: boolean;
  readonly children?: ReactNode;
  /** Layout context from the parent (grid placement, margin); never colour or size. */
  readonly className?: string;
}

/** The shell a dashboard section or a chart sits in: header, body and footer chrome in one place. */
export function SectionCard({ title, subtitle, action, footer, footerDivider = false, padded, children, className }: SectionCardProps): ReactElement {
  const hasHeader = title !== undefined || action !== undefined;
  return (
    <section aria-label={title} className={cn(sectionCardVariants(), className)}>
      {hasHeader && (
        <header className={sectionCardHeaderVariants()}>
          <div>
            {title !== undefined && <div className={sectionCardTitleVariants()}>{title}</div>}
            {subtitle !== undefined && <div className={sectionCardSubtitleVariants()}>{subtitle}</div>}
          </div>
          {action !== undefined && <div className={sectionCardActionVariants()}>{action}</div>}
        </header>
      )}
      <div className={sectionCardBodyVariants({ padded })}>{children}</div>
      {footer !== undefined && <div className={sectionCardFooterVariants({ divider: footerDivider })}>{footer}</div>}
    </section>
  );
}
