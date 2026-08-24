import { clsx, type ClassValue } from 'clsx';

/**
 * Conditional class names.
 *
 * Deliberately `clsx` alone, without `tailwind-merge`. Merge exists to let a
 * caller override a component's own classes by passing a conflicting utility,
 * which is a pattern this codebase does not use: the primitives in
 * `components/ui` take variant props, and `className` is for additive layout
 * (margins, grid placement) only. Skipping the merge saves the larger of the
 * two dependencies and removes a class of silent, order-dependent surprises.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
