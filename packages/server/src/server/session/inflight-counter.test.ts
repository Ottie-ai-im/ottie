import { describe, expect, it } from "vitest";

import { InflightCounter } from "./inflight-counter.js";

describe("session/inflight-counter — InflightCounter", () => {
  it("starts at zero with peak zero", () => {
    const c = new InflightCounter();
    expect(c.value).toBe(0);
    expect(c.peak).toBe(0);
  });

  it("increment/decrement round-trips and value reflects current", () => {
    const c = new InflightCounter();
    c.increment();
    c.increment();
    c.increment();
    expect(c.value).toBe(3);
    c.decrement();
    expect(c.value).toBe(2);
    c.decrement();
    c.decrement();
    expect(c.value).toBe(0);
  });

  it("peak tracks the high-water-mark across increments", () => {
    const c = new InflightCounter();
    c.increment();
    c.increment();
    c.increment();
    expect(c.peak).toBe(3); // peak rises with each new high
    c.decrement();
    c.decrement();
    expect(c.peak).toBe(3); // peak does NOT drop on decrement
    expect(c.value).toBe(1);
    c.increment();
    expect(c.peak).toBe(3); // still 3 — current is 2, not above the prior peak
    c.increment();
    c.increment();
    c.increment();
    // current went from 1 → 2 → 3 → 4 → 5 across this block, so new peak is 5.
    expect(c.value).toBe(5);
    expect(c.peak).toBe(5);
  });

  it("resetPeak() returns peak to current value", () => {
    const c = new InflightCounter();
    c.increment();
    c.increment();
    c.increment();
    expect(c.peak).toBe(3);
    c.decrement();
    expect(c.peak).toBe(3);
    c.resetPeak();
    expect(c.peak).toBe(2); // reset to current value (2 after one decrement)
  });
});
