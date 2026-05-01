import { describe, expect, it } from "vitest";

import { RESERVED_FIELDS } from "./messages.js";

describe("schema evolution discipline (ARCH-02)", () => {
  it("exports a RESERVED_FIELDS registry", () => {
    expect(RESERVED_FIELDS).toBeDefined();
    expect(typeof RESERVED_FIELDS).toBe("object");
    expect(RESERVED_FIELDS).not.toBeNull();
  });

  it("RESERVED_FIELDS is shaped as Record<string, readonly string[]>", () => {
    // Each entry (if any) must map a schema name to an array of reserved field names.
    for (const [schemaName, fields] of Object.entries(RESERVED_FIELDS)) {
      expect(typeof schemaName).toBe("string");
      expect(Array.isArray(fields)).toBe(true);
      for (const field of fields) {
        expect(typeof field).toBe("string");
      }
    }
  });
});
