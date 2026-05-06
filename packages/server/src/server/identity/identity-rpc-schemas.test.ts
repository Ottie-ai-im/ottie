import { describe, expect, test } from "vitest";

import {
  DevicesListRequestSchema,
  DevicesListResponseSchema,
  FriendPairCancelRequestSchema,
  FriendPairCancelResponseSchema,
  FriendPairGenerateRequestSchema,
  FriendPairGenerateResponseSchema,
  FriendPairRedeemRequestSchema,
  FriendPairRedeemResponseSchema,
  IdentityGetRequestSchema,
  IdentityGetResponseSchema,
  IdentityInitializeRequestSchema,
  IdentityInitializeResponseSchema,
  IdentityStateOnWireSchema,
  PublicRootIdentitySchema,
  toPublicRootIdentity,
} from "./identity-rpc-schemas.js";
import type { StoredDevice } from "./device-types.js";
import type { StoredRootIdentity } from "./identity-types.js";

const DEVICE_FIXTURE: StoredDevice = {
  v: 1,
  deviceId: "srv_fixture_1",
  deviceLabel: "Fixture-MacBook",
  role: "daemon",
  signPublicKeyB64: "z".repeat(43),
  authorizedAt: "2026-05-05T12:00:00.000Z",
  authorizationSignatureB64: "sig_".padEnd(86, "x"),
};

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

describe("device/list request/response schemas (Phase 2.b)", () => {
  test("request roundtrips", () => {
    const wire = { type: "device/list", requestId: "req-d-1" };
    expect(DevicesListRequestSchema.parse(wire)).toEqual(wire);
  });

  test("response roundtrips with single-device list", () => {
    const wire = {
      type: "device/list/response",
      payload: {
        requestId: "req-d-1",
        devices: [DEVICE_FIXTURE],
        error: null,
      },
    };
    expect(DevicesListResponseSchema.parse(wire)).toEqual(wire);
  });

  test("response roundtrips with empty list", () => {
    const wire = {
      type: "device/list/response",
      payload: {
        requestId: "req-d-1",
        devices: [],
        error: null,
      },
    };
    expect(DevicesListResponseSchema.parse(wire)).toEqual(wire);
  });

  test("response allows null devices with error (service unavailable)", () => {
    const wire = {
      type: "device/list/response",
      payload: {
        requestId: "req-d-1",
        devices: null,
        error: "Identity service is not available on this daemon",
      },
    };
    expect(DevicesListResponseSchema.parse(wire)).toEqual(wire);
  });

  test("rejects device with missing required field", () => {
    const wire = {
      type: "device/list/response",
      payload: {
        requestId: "req-d-1",
        devices: [{ ...DEVICE_FIXTURE, signPublicKeyB64: undefined }],
        error: null,
      },
    };
    expect(() => DevicesListResponseSchema.parse(wire)).toThrow();
  });
});

describe("friend/pair/generate request/response schemas (Phase 3.a/1)", () => {
  test("request roundtrips without ttlMs", () => {
    const wire = { type: "friend/pair/generate", requestId: "req-fp-1" };
    expect(FriendPairGenerateRequestSchema.parse(wire)).toEqual(wire);
  });

  test("request roundtrips with ttlMs override", () => {
    const wire = { type: "friend/pair/generate", requestId: "req-fp-1", ttlMs: 60_000 };
    expect(FriendPairGenerateRequestSchema.parse(wire)).toEqual(wire);
  });

  test("request rejects non-positive ttlMs", () => {
    expect(() =>
      FriendPairGenerateRequestSchema.parse({
        type: "friend/pair/generate",
        requestId: "req-fp-1",
        ttlMs: 0,
      }),
    ).toThrow();
  });

  test("response success roundtrips with offer + deepLink", () => {
    const wire = {
      type: "friend/pair/generate/response",
      payload: {
        requestId: "req-fp-1",
        offer: {
          v: 1,
          kind: "friend-pair",
          serverId: "srv_alice",
          rootSignPublicKeyB64: "x".repeat(43),
          displayName: "Alice",
          ephPublicKeyB64: "y".repeat(43),
          nonceB64: "z".repeat(43),
          exp: "2030-01-01T00:00:00.000Z",
          relayEndpoint: "relay.claws.company:443",
        },
        deepLink: "ottie://friend-pair#payload=abc",
        error: null,
      },
    };
    expect(FriendPairGenerateResponseSchema.parse(wire)).toEqual(wire);
  });

  test("response allows null offer + null deepLink with error string", () => {
    const wire = {
      type: "friend/pair/generate/response",
      payload: {
        requestId: "req-fp-1",
        offer: null,
        deepLink: null,
        error: "Identity service is not available on this daemon",
      },
    };
    expect(FriendPairGenerateResponseSchema.parse(wire)).toEqual(wire);
  });
});

describe("friend/pair/cancel request/response schemas (Phase 3.a/1)", () => {
  test("request roundtrips", () => {
    const wire = {
      type: "friend/pair/cancel",
      requestId: "req-fp-c-1",
      nonceB64: "n".repeat(32),
    };
    expect(FriendPairCancelRequestSchema.parse(wire)).toEqual(wire);
  });

  test("request rejects empty nonce", () => {
    expect(() =>
      FriendPairCancelRequestSchema.parse({
        type: "friend/pair/cancel",
        requestId: "req-fp-c-1",
        nonceB64: "",
      }),
    ).toThrow();
  });

  test("response roundtrips on success", () => {
    const wire = {
      type: "friend/pair/cancel/response",
      payload: { requestId: "req-fp-c-1", cancelled: true, error: null },
    };
    expect(FriendPairCancelResponseSchema.parse(wire)).toEqual(wire);
  });

  test("response roundtrips on failure", () => {
    const wire = {
      type: "friend/pair/cancel/response",
      payload: {
        requestId: "req-fp-c-1",
        cancelled: false,
        error: "Identity service is not available on this daemon",
      },
    };
    expect(FriendPairCancelResponseSchema.parse(wire)).toEqual(wire);
  });
});

describe("friend/pair/redeem request/response schemas (Phase 3.a/2)", () => {
  test("request roundtrips with a deep link", () => {
    const wire = {
      type: "friend/pair/redeem",
      requestId: "req-fp-r-1",
      deepLink: "ottie://friend-pair#payload=abc",
    };
    expect(FriendPairRedeemRequestSchema.parse(wire)).toEqual(wire);
  });

  test("request rejects empty deepLink", () => {
    expect(() =>
      FriendPairRedeemRequestSchema.parse({
        type: "friend/pair/redeem",
        requestId: "r",
        deepLink: "",
      }),
    ).toThrow();
  });

  test("response candidate-received outcome roundtrips", () => {
    const wire = {
      type: "friend/pair/redeem/response",
      payload: {
        requestId: "req-fp-r-1",
        outcome: {
          status: "candidate-received" as const,
          remoteDisplayName: "Alice",
          remoteRootSignPublicKeyB64: "x".repeat(43),
        },
        error: null,
      },
    };
    expect(FriendPairRedeemResponseSchema.parse(wire)).toEqual(wire);
  });

  test("response rejected outcome roundtrips", () => {
    const wire = {
      type: "friend/pair/redeem/response",
      payload: {
        requestId: "req-fp-r-1",
        outcome: {
          status: "rejected" as const,
          errorCode: "no_offer",
          errorMessage: "The friend-pair link has expired or already been used",
        },
        error: null,
      },
    };
    expect(FriendPairRedeemResponseSchema.parse(wire)).toEqual(wire);
  });

  test("response allows null outcome with error string (service unavailable)", () => {
    const wire = {
      type: "friend/pair/redeem/response",
      payload: {
        requestId: "req-fp-r-1",
        outcome: null,
        error: "Identity service is not available on this daemon",
      },
    };
    expect(FriendPairRedeemResponseSchema.parse(wire)).toEqual(wire);
  });
});
