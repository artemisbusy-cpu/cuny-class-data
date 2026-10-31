/**
 * Registration seasons get a nightly refresh; the rest of the year runs on Sundays only.
 * Nightly: Oct 15 - Feb 15 (Spring) and Mar 15 - Sep 15 (Fall). Edit WINDOWS to change.
 * CLI: prints `run=true|false` (for $GITHUB_OUTPUT).
 */

// [startMonth, startDay, endMonth, endDay], months 1-12, inclusive; may wrap the new year.
export const WINDOWS: [number, number, number, number][] = [
  [10, 15, 2, 15],
  [3, 15, 9, 15],
];

const md = (m: number, d: number) => m * 100 + d;

export function inWindow(date: Date): boolean {
  const today = md(date.getUTCMonth() + 1, date.getUTCDate());
  return WINDOWS.some(([sm, sd, em, ed]) => {
    const a = md(sm, sd), b = md(em, ed);
    return a <= b ? today >= a && today <= b : today >= a || today <= b;
  });
}

export function shouldRun(date: Date): boolean {
  return inWindow(date) || date.getUTCDay() === 0;
}

if (process.argv[1]?.endsWith("season.ts")) {
  console.log(`run=${process.env.FORCE === "true" || shouldRun(new Date())}`);
}
