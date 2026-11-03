import type { ReactElement, ReactNode } from 'react';

import { cn } from '@open-tomato/charts';

import {
  toolbarControlsVariants,
  toolbarCountVariants,
  toolbarNounVariants,
  toolbarSeparatorVariants,
  toolbarSummaryRuleVariants,
  toolbarSummaryVariants,
  toolbarVariants,
  type ToolbarSummaryVariants,
} from './Toolbar.variants.js';

/** The props every toolbar part takes: the children and a layout-only passthrough class. */
export interface ToolbarPartProps {
  readonly children?: ReactNode;
  /** Layout context from the parent (margin, placement); never colour or size. */
  readonly className?: string;
}

/**
 * The toolbar surface. Compose it:
 *
 * ```tsx
 * <Toolbar>
 *   <ToolbarControls><SearchInput … /><FilterDropdown … /><ToolbarSeparator /><Segmented … /></ToolbarControls>
 *   <ToolbarSummary divided={attached}><ToolbarCount count={n} noun="sessions" />…chips…</ToolbarSummary>
 *   {attached && <Table frame={false} … />}
 * </Toolbar>
 * ```
 */
export function Toolbar({ children, className }: ToolbarPartProps): ReactElement {
  return <div className={cn(toolbarVariants(), className)}>{children}</div>;
}

/** The controls band: search, filters, view controls. */
export function ToolbarControls({ children, className }: ToolbarPartProps): ReactElement {
  return <div role="toolbar" className={cn(toolbarControlsVariants(), className)}>{children}</div>;
}

/** The summary band's props: `divided` rules it below when a table follows inside the surface. */
export interface ToolbarSummaryProps extends ToolbarPartProps, ToolbarSummaryVariants {}

/** The summary band: the count, the active-filter chips, clear all. */
export function ToolbarSummary({ divided, children, className }: ToolbarSummaryProps): ReactElement {
  return <div className={cn(toolbarSummaryVariants({ divided }), className)}>{children}</div>;
}

/** The vertical hairline between control clusters. */
export function ToolbarSeparator({ className }: { readonly className?: string }): ReactElement {
  return <div aria-hidden="true" className={cn(toolbarSeparatorVariants(), className)} />;
}

/** The count's props: the number, its noun, and the whole it is of while filtered. */
export interface ToolbarCountProps {
  readonly count: number;
  /** "sessions", "issues". */
  readonly noun: string;
  /** The unfiltered total; given, the noun reads "of N sessions". */
  readonly of?: number;
}

/** The count at the start of the summary band: "12 sessions", or "3 of 12 sessions" while filtered. */
export function ToolbarCount({ count, noun, of }: ToolbarCountProps): ReactElement {
  return (
    <>
      <span className={toolbarCountVariants()}>{count}</span>
      <span className={toolbarNounVariants()}>
        {of === undefined
          ? noun
          : `of ${of} ${noun}`}
      </span>
    </>
  );
}

/** The short hairline between the count and the chips. */
export function ToolbarSummaryRule(): ReactElement {
  return <div aria-hidden="true" className={toolbarSummaryRuleVariants()} />;
}
