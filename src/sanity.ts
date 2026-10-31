/**
 * A refresh that suddenly returns far fewer sections usually means CUNY changed its page, not
 * that half the classes vanished. Refuse to publish when the count drops more than 50%.
 */
export function passesSanity(prev: number | null, next: number): boolean {
  if (next === 0) return false;
  if (prev == null || prev === 0) return true;
  return next >= prev * 0.5;
}

/** A term CUNY lists before any classes are posted (e.g. next summer): skip it, it isn't a failure. */
export function notPostedYet(prev: number | null, next: number): boolean {
  return next === 0 && (prev == null || prev === 0);
}
