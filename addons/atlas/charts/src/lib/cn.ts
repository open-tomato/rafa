import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Joins class values and resolves Tailwind conflicts, the later class
 * winning. A component calls it as `cn(xVariants({ ... }), className)`, so
 * the passthrough `className` merges last and can override layout only.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
