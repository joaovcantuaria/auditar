/**
 * Tiny className concatenation helper.
 * Accepts strings, falsy values (ignored), and simple objects keyed by class name
 * whose truthy values include the key. Keeps the bundle dependency-free.
 *
 * @example
 *   cn('btn', isActive && 'btn-active', { 'btn-lg': large })
 */
export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | Record<string, boolean | null | undefined>;

export function cn(...args: ClassValue[]): string {
  const classes: string[] = [];

  for (const arg of args) {
    if (!arg) continue;

    if (typeof arg === 'string' || typeof arg === 'number') {
      classes.push(String(arg));
      continue;
    }

    if (typeof arg === 'object') {
      for (const [key, value] of Object.entries(arg)) {
        if (value) classes.push(key);
      }
    }
  }

  return classes.join(' ');
}

export default cn;
