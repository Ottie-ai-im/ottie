/**
 * Tracks in-flight request count and high-water-mark for a single Session.
 *
 * Extracted from `session.ts` per carve plan 01-04 to satisfy the D-02 wc -l
 * shrinkage invariant — the two private fields (`inflightRequests`,
 * `peakInflightRequests`) and the inline arithmetic in `handleMessage` were
 * collapsed into method calls on a single instance of this class.
 */
export class InflightCounter {
  private current = 0;
  private peakValue = 0;

  /** Increment the in-flight count by 1; updates peak if a new high-water mark. */
  increment(): void {
    this.current++;
    if (this.current > this.peakValue) {
      this.peakValue = this.current;
    }
  }

  /** Decrement the in-flight count by 1. Peak is unaffected by decrement. */
  decrement(): void {
    this.current--;
  }

  /** Current in-flight count. */
  get value(): number {
    return this.current;
  }

  /** High-water-mark since construction or the last `resetPeak()` call. */
  get peak(): number {
    return this.peakValue;
  }

  /**
   * Reset the peak to the current in-flight value. Used by diagnostics surfaces
   * that read peak periodically and want to track per-window highs.
   */
  resetPeak(): void {
    this.peakValue = this.current;
  }
}
