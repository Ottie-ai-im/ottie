import { describe, it, expect } from "vitest";
import { relLuminance, contrastRatio, parseColor } from "./contrast-aa-audit";

describe("contrast-aa-audit math", () => {
  it("computes relative luminance correctly", () => {
    expect(relLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1.0, 5);
    expect(relLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    // #777777 (mid-gray)
    expect(relLuminance({ r: 119, g: 119, b: 119 })).toBeCloseTo(0.18418, 3);
  });

  it("computes contrast ratio correctly", () => {
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBe(21);
    // #777 vs white should be around 4.47
    expect(contrastRatio({ r: 119, g: 119, b: 119 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(
      4.47,
      1,
    );
  });

  it("parses colors correctly", () => {
    expect(parseColor("#ffffff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseColor("rgba(255, 0, 0, 0.5)")).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
  });
});
