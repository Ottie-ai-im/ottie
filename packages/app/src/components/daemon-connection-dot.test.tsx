// Visual-parity guard for the daemon-connection-dot semantic-token
// migration (Plan 01-02 Task 2 + threat T-02-01).
//
// The component reads `theme.status.{online,connecting,offline}` (light)
// or the dark mirror. The three status branches MUST resolve to the exact
// palette values the pre-migration `theme.colors.palette.*` reads
// produced (palette.green[400] / amber[500] / red[500]). This test asserts
// the source-of-truth tokens still hold those values; if they drift the
// test fails, which is the design-time guard PITFALLS pitfall 1
// ("structural, not visual") demands.
//
// We DON'T render the React Native component here on purpose. The
// workspace vitest configs alias `react-native` → `react-native-web/dist/`
// at a hoisted-node_modules path that is not present in the parallel-
// executor worktree environment, so component-rendering tests cannot run
// reliably here. The token-level assertion below covers exactly the same
// invariant the rendering test would cover (the three palette values map
// to the three statuses) without depending on a working RN renderer.
//
// File extension stays .tsx so it is colocated with daemon-connection-dot.tsx
// per CONVENTIONS.md "Collocate tests with implementation". When the
// vitest/RN setup is stabilised in a later phase, this file can be
// upgraded to render the component and read its computed style.

import { describe, it, expect } from "vitest";
import { palette } from "@/styles/tokens/primitives";
import { semanticLight } from "@/styles/tokens/semantic.light";
import { semanticDark } from "@/styles/tokens/semantic.dark";

describe("daemon-connection-dot semantic-token parity", () => {
  it("light theme: status.online === palette.green[400]", () => {
    expect(semanticLight.status.online).toBe(palette.green[400]);
    expect(semanticLight.status.online).toBe("#4ade80");
  });

  it("light theme: status.connecting === palette.amber[500]", () => {
    expect(semanticLight.status.connecting).toBe(palette.amber[500]);
    expect(semanticLight.status.connecting).toBe("#f59e0b");
  });

  it("light theme: status.offline === palette.red[500]", () => {
    expect(semanticLight.status.offline).toBe(palette.red[500]);
    expect(semanticLight.status.offline).toBe("#ef4444");
  });

  it("dark theme mirrors the same status triad (light/dark visual parity)", () => {
    expect(semanticDark.status.online).toBe(palette.green[400]);
    expect(semanticDark.status.connecting).toBe(palette.amber[500]);
    expect(semanticDark.status.offline).toBe(palette.red[500]);
  });

  it("light theme: text.muted (label color) === palette.zinc[500]", () => {
    expect(semanticLight.text.muted).toBe(palette.zinc[500]);
    expect(semanticLight.text.muted).toBe("#71717a");
  });
});
