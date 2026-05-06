import { describe, expect, test } from "vitest";

import {
  IdentityGetRequestSchema,
  IdentityGetResponseSchema,
  IdentityInitializeRequestSchema,
  IdentityInitializeResponseSchema,
  IdentityStateOnWireSchema,
  PublicRootIdentitySchema,
  toPublicRootIdentity,
} from "./identity-rpc-schemas.js";
import type { StoredRootIdentity } from "./identity-types.js";

const STORED_FIXTURE: StoredRootIdentity = {
  v: 1,
  signPublicKeyB64: "pub_b64url_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  signPrivateKeyB64: "priv_b64url_secret_NEVER_GOES_OVER_THE_WIRE",
  displayName: "Wendell",
  createdAt: "2026-05-05T12:00:00.000Z",
};

describe("toPublicRootIdentity", () => {
  test("strips the private key", () => {
    const pub = toPublicRootIdentity(STORED_FIXTURE);
    expect(pub).toEqual({
      v: 1,
      rootSignPublicKeyB64: STORED_FIXTURE.signPublicKeyB64,
      displayName: "Wendell",
      createdAt: STORED_FIXTURE.createdAt,
    });
    // Defensive: explicitly assert the private key field isn't present.
    expect(pub).not.toHaveProperty("signPrivateKeyB64");
    expect(JSON.stringify(pub)).not.toContain("priv_b64url_secret");
  });

  test("output passes PublicRootIdentitySchema", () => {
    const pub = toPublicRootIdentity(STORED_FIXTURE);
    expect(() => PublicRootIdentitySchema.parse(pub)).not.toThrow();
  });
});

describe("IdentityStateOnWireSchema", () => {
  test("accepts uninitialized", () => {
    const result = IdentityStateOnWireSchema.parse({ kind: "uninitialized" });
    expect(result.kind).toBe("uninitialized");
  });

  test("accepts loaded with public identity", () => {
    const wire = {
      kind: "loaded" as const,
      identity: toPublicRootIdentity(STORED_FIXTURE),
    };
    const result = IdentityStateOnWireSchema.parse(wire);
    expect(result.kind).toBe("loaded");
    if (result.kind === "loaded") {
      expect(result.identity.displayName).toBe("Wendell");
    }
  });

  test("accepts load-failed with error string", () => {
    const result = IdentityStateOnWireSchema.parse({
      kind: "load-failed",
      error: "schema mismatch at field 'v'",
    });
    expect(result.kind).toBe("load-failed");
  });

  test("rejects loaded without identity field", () => {
    expect(() => IdentityStateOnWireSchema.parse({ kind: "loaded" })).toThrow();
  });
});

describe("IdentityGet request/response schemas", () => {
  test("request roundtrips", () => {
    const wire = { type: "identity/get", requestId: "req-1" };
    expect(IdentityGetRequestSchema.parse(wire)).toEqual(wire);
  });

  test("response roundtrips for uninitialized state", () => {
    const wire = {
      type: "identity/get/response",
      payload: {
        requestId: "req-1",
        state: { kind: "uninitialized" },
        error: null,
      },
    };
    expect(IdentityGetResponseSchema.parse(wire)).toEqual(wire);
  });

  test("response roundtrips for loaded state with public identity", () => {
    const wire = {
      type: "identity/get/response",
      payload: {
        requestId: "req-1",
        state: {
          kind: "loaded",
          identity: toPublicRootIdentity(STORED_FIXTURE),
        },
        error: null,
      },
    };
    expect(IdentityGetResponseSchema.parse(wire)).toEqual(wire);
  });

  test("response allows null state with error (service unavailable)", () => {
    const wire = {
      type: "identity/get/response",
      payload: {
        requestId: "req-1",
        state: null,
        error: "Identity service is not available on this daemon",
      },
    };
    expect(IdentityGetResponseSchema.parse(wire)).toEqual(wire);
  });
});

describe("IdentityInitialize request/response schemas", () => {
  test("request requires non-empty displayName", () => {
    expect(() =>
      IdentityInitializeRequestSchema.parse({
        type: "identity/initialize",
        requestId: "r",
        displayName: "",
      }),
    ).toThrow();
  });

  test("request rejects displayName longer than 64 characters", () => {
    expect(() =>
      IdentityInitializeRequestSchema.parse({
        type: "identity/initialize",
        requestId: "r",
        displayName: "a".repeat(65),
      }),
    ).toThrow();
  });

  test("request accepts a valid displayName", () => {
    const wire = {
      type: "identity/initialize",
      requestId: "r",
      displayName: "Wendell",
    };
    expect(IdentityInitializeRequestSchema.parse(wire)).toEqual(wire);
  });

  test("response success roundtrips", () => {
    const wire = {
      type: "identity/initialize/response",
      payload: {
        requestId: "r",
        identity: toPublicRootIdentity(STORED_FIXTURE),
        error: null,
      },
    };
    expect(IdentityInitializeResponseSchema.parse(wire)).toEqual(wire);
  });

  test("response failure (null identity + error string) roundtrips", () => {
    const wire = {
      type: "identity/initialize/response",
      payload: {
        requestId: "r",
        identity: null,
        error: 'Cannot initialize root identity: current state is "loaded"',
      },
    };
    expect(IdentityInitializeResponseSchema.parse(wire)).toEqual(wire);
  });
});
