import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { semanticLight } from "../../packages/app/src/styles/tokens/semantic.light";
import { semanticDark } from "../../packages/app/src/styles/tokens/semantic.dark";

interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Parses hex (#fff, #ffffff) and rgba strings into RGB+A components.
 */
export function parseColor(c: string): RGB & { a: number } {
  if (!c) return { r: 0, g: 0, b: 0, a: 1 };

  if (c.startsWith("#")) {
    let r, g, b;
    if (c.length === 4) {
      r = parseInt(c[1] + c[1], 16);
      g = parseInt(c[2] + c[2], 16);
      b = parseInt(c[3] + c[3], 16);
    } else {
      r = parseInt(c.slice(1, 3), 16);
      g = parseInt(c.slice(3, 5), 16);
      b = parseInt(c.slice(5, 7), 16);
    }
    return { r, g, b, a: 1 };
  }

  if (c.startsWith("rgba") || c.startsWith("rgb")) {
    const match = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (match) {
      return {
        r: parseInt(match[1]),
        g: parseInt(match[2]),
        b: parseInt(match[3]),
        a: match[4] ? parseFloat(match[4]) : 1,
      };
    }
  }

  // Common literals used in the project
  if (c === "white" || c === "#ffffff") return { r: 255, g: 255, b: 255, a: 1 };
  if (c === "black" || c === "#000000") return { r: 0, g: 0, b: 0, a: 1 };

  return { r: 0, g: 0, b: 0, a: 1 };
}

/**
 * Relative luminance per WCAG 2.1.
 */
export function relLuminance({ r, g, b }: RGB): number {
  const norm = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * norm(r) + 0.7152 * norm(g) + 0.0722 * norm(b);
}

/**
 * Contrast ratio formula: (L1 + 0.05) / (L2 + 0.05).
 */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relLuminance(a),
    lb = relLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Simple alpha compositing (over operator) on a solid background.
 */
export function alphaComposite(over: RGB & { a: number }, under: RGB): RGB {
  const a = over.a;
  return {
    r: Math.round(over.r * a + under.r * (1 - a)),
    g: Math.round(over.g * a + under.g * (1 - a)),
    b: Math.round(over.b * a + under.b * (1 - a)),
  };
}

const REPORT_PATH =
  ".planning/phases/02-onboarding-navigation-settings-theme-native-feel-polish/02e-contrast-aa-report.md";

interface AuditResult {
  pair: string;
  lightRatio: number;
  lightPass: boolean;
  darkRatio: number;
  darkPass: boolean;
  threshold: number;
}

function main() {
  const results: AuditResult[] = [];
  let allPass = true;

  const pairs = [
    {
      name: "Primary Text on Background",
      bg: "surface.background",
      fg: "text.primary",
      threshold: 4.5,
    },
    {
      name: "Primary Text on Elevated",
      bg: "surface.elevated",
      fg: "text.primary",
      threshold: 4.5,
    },
    {
      name: "Primary Text on Glass",
      bg: "surface.glass.tint",
      fg: "text.primary",
      threshold: 4.5,
      composite: true,
    },
    {
      name: "Muted Text on Background",
      bg: "surface.background",
      fg: "text.muted",
      threshold: 4.5,
    },
    { name: "Muted Text on Elevated", bg: "surface.elevated", fg: "text.muted", threshold: 4.5 },
    {
      name: "Self Bubble Text",
      bg: "surface.bubble.self",
      fg: "text.bubble.self",
      threshold: 4.5,
      composite: true,
    },
    {
      name: "Other Bubble Text",
      bg: "surface.bubble.other",
      fg: "text.bubble.other",
      threshold: 4.5,
      composite: true,
    },
    {
      name: "Destructive on Background",
      bg: "surface.background",
      fg: "status.destructive",
      threshold: 4.5,
    },
    {
      name: "Success on Background",
      bg: "surface.background",
      fg: "status.success",
      threshold: 4.5,
    },
    {
      name: "Warning on Background",
      bg: "surface.background",
      fg: "status.statusWarning",
      threshold: 4.5,
    },
  ];

  // The token tree is `{ surface: { background: "#fff", ... }, ... }` —
  // dotted-path lookup that returns the leaf string color. Typed as
  // `unknown → string` because the tree is heterogeneous; callers pass
  // the result straight to parseColor which validates the string shape.
  function getVal(obj: Record<string, unknown>, path: string): string {
    const result = path.split(".").reduce<unknown>(
      (o, key) =>
        typeof o === "object" && o !== null ? (o as Record<string, unknown>)[key] : undefined,
      obj,
    );
    return typeof result === "string" ? result : "";
  }

  for (const p of pairs) {
    // Light mode
    let bgLValue = getVal(semanticLight, p.bg);
    let fgLValue = getVal(semanticLight, p.fg);
    let bgL = parseColor(bgLValue);
    let fgL = parseColor(fgLValue);
    if (p.composite) {
      bgL = { ...alphaComposite(bgL, parseColor(semanticLight.surface.background)), a: 1 };
    }
    const ratioL = contrastRatio(bgL, fgL);
    const passL = ratioL >= p.threshold;

    // Dark mode
    let bgDValue = getVal(semanticDark, p.bg);
    let fgDValue = getVal(semanticDark, p.fg);
    let bgD = parseColor(bgDValue);
    let fgD = parseColor(fgDValue);
    if (p.composite) {
      bgD = { ...alphaComposite(bgD, parseColor(semanticDark.surface.background)), a: 1 };
    }
    const ratioD = contrastRatio(bgD, fgD);
    const passD = ratioD >= p.threshold;

    if (!passL || !passD) allPass = false;

    results.push({
      pair: p.name,
      lightRatio: ratioL,
      lightPass: passL,
      darkRatio: ratioD,
      darkPass: passD,
      threshold: p.threshold,
    });
  }

  let md = "# WCAG 2.1 AA Contrast Audit Report (THM-05)\n\n";
  md += `Result: ${allPass ? "PASS" : "FAIL"}\n\n`;
  md += "| Pair | Light Ratio | Light Pass | Dark Ratio | Dark Pass | Threshold |\n";
  md += "| :--- | :--- | :--- | :--- | :--- | :--- |\n";
  for (const r of results) {
    md += `| ${r.pair} | ${r.lightRatio.toFixed(2)}:1 | ${r.lightPass ? "✅" : "❌"} | ${r.darkRatio.toFixed(2)}:1 | ${r.darkPass ? "✅" : "❌"} | ${r.threshold}:1 |\n`;
  }

  const reportAbsPath = resolve(REPORT_PATH);
  writeFileSync(reportAbsPath, md);
  process.stderr.write(`Audit report written to ${REPORT_PATH}\n`);

  if (!allPass) {
    process.stderr.write(
      `FAIL: Some pairs did not meet the AA contrast threshold. See report for details.\n`,
    );
    process.exit(1);
  }

  process.stderr.write(`✓ Contrast audit clean: All checked pairs meet AA requirements.\n`);
  process.exit(0);
}

// Only run main if this file is the entry point
if (resolve(process.argv[1]) === resolve(import.meta.url.replace("file://", ""))) {
  main();
}
