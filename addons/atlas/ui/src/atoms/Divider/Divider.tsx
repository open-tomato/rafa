import type { ReactElement, ReactNode } from 'react';

import { cn } from '@open-tomato/charts';

import { dividerLabelVariants, dividerRuleVariants, dividerVariants } from './Divider.variants.js';

/** A divider's props: an optional label mid-rule and a layout-only passthrough class. */
export interface DividerProps {
  /** A small mono label mid-rule; left out, the rule is plain. */
  readonly label?: ReactNode;
  /** Layout context from the parent (margin); never colour or size. */
  readonly className?: string;
}

/** A horizontal rule, plain or interrupted by a label; a separator for assistive technology. */
export function Divider({ label, className }: DividerProps): ReactElement {
  if (label === undefined || label === null) {
    return <div role="separator" className={cn(dividerVariants({ labeled: false }), className)} />;
  }
  return (
    <div role="separator" className={cn(dividerVariants({ labeled: true }), className)}>
      <span className={dividerRuleVariants()} />
      <span className={dividerLabelVariants()}>{label}</span>
      <span className={dividerRuleVariants()} />
    </div>
  );
}
