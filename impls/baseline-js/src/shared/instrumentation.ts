// The optional instrumentation hooks of baseline-js. Both games take them, and only the runner passes them.
/**
 * Optional region timer (runner/src/budget.ts). `begin` and `end` bracket a named facet region and may nest.
 * `naive` names the regions that run their naive code (same hash, slower). Without it every call is a no-op.
 */
export interface Regions {
  begin(name: string): void
  end(name: string): void
  naive: ReadonlySet<string>
}

/** Optional work-count hooks (runner/src/profile.ts). `add` accumulates, `set` records a per-tick gauge. Never read back. */
export interface Counters {
  add(name: string, n?: number): void
  set(name: string, v: number): void
}
