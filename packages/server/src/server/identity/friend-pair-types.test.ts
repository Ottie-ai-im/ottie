import { describe, expect, test } from "vitest";

import {
  FriendPairOfferSchema,
  decodeFriendPairOffer,
  encodeFriendPairOffer,
  type FriendPairOffer,
} from "./friend-pair-types.js";

const SAMPLE: FriendPairOffer = {
  v: 1,
  kind: "friend-pair",
  serverId: "srv_alice",
  rootSignPublicKeyB64: "x".repeat(43),
  displayName: "Alice",
  ephPublicKeyB64: "y".repeat(43),
  nonceB64: "z".repeat(43),
  exp: "2030-01-01T00:00:00.000Z",
  relayEndpoint: "relay.claws.company:443",
};

describe("encodeFriendPairOffer / decodeFriendPairOffer", () => {
  test("roundtrips a valid offer through the deep-link form", () => {
    const link = encodeFriendPairOffer(SAMPLE);
    expect(link.startsWith("ottie://friend-pair#payload=")).toBe(true);
    expect(decodeFriendPairOffer(link)).toEqual(SAMPLE);
  });

  test("encoded payload is base64url (no '+', '/', or '=' padding)", () => {
    const link = encodeFriendPairOffer(SAMPLE);
    const payload = link.split("payload=")[1] ?? "";
    expect(payload).not.toMatch(/[+/=]/);
  });

  test("decode accepts unicode display names roundtripped through utf-8", () => {
    const offer: FriendPairOffer = { ...SAMPLE, displayName: "温德尔 🦦" };
    const decoded = decodeFriendPairOffer(encodeFriendPairOffer(offer));
    expect(decoded.displayName).toBe("温德尔 🦦");
  });

  test("decode rejects strings missing the 'payload=' marker", () => {
    expect(() => decodeFriendPairOffer("ottie://friend-pair")).toThrow(/payload=/);
    expect(() => decodeFriendPairOffer("not a link")).toThrow(/payload=/);
  });

  test("decode rejects payloads that don't match the schema", () => {
    const tampered = Buffer.from(JSON.stringify({ kind: "device-link", v: 1 }), "utf8")
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    expect(() => decodeFriendPairOffer(`ottie://friend-pair#payload=${tampered}`)).toThrow();
  });
});

describe("FriendPairOfferSchema", () => {
  test("rejects display names longer than 64 chars", () => {
    const result = FriendPairOfferSchema.safeParse({ ...SAMPLE, displayName: "x".repeat(65) });
    expect(result.success).toBe(false);
  });

  test("rejects empty required fields", () => {
    for (const field of [
      "serverId",
      "rootSignPublicKeyB64",
      "displayName",
      "ephPublicKeyB64",
      "nonceB64",
      "relayEndpoint",
    ] as const) {
      const result = FriendPairOfferSchema.safeParse({ ...SAMPLE, [field]: "" });
      expect(result.success, `field ${field} should reject empty string`).toBe(false);
    }
  });

  test("requires kind to be the literal 'friend-pair'", () => {
    const result = FriendPairOfferSchema.safeParse({ ...SAMPLE, kind: "device-link" });
    expect(result.success).toBe(false);
  });
});
