/** The one clock seam for quiz expiry and daily limits. */
let clock: () => number = () => Date.now();

export function now(): number {
  return clock();
}

/** Test hook. Production code never changes the clock. */
export function setClockForTests(next?: () => number): void {
  clock = next ?? (() => Date.now());
}

export function dayKey(at = now()): string {
  return new Date(at).toISOString().slice(0, 10);
}
