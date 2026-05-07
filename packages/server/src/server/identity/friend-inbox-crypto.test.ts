import { generateKeyPairSync, sign as nodeSign, type KeyObject } from "node:crypto";

import { describe, expect, test } from "vitest";

import { p2pRoomId } from "../chat/chat-types.js";
import { buildFriendChatMessageEnvelope } from "./friend-chat-crypto.js";
import { decryptInboxBlob, encryptInboxBlob } from "./friend-inbox-crypto.js";
import { InboxBlobSchema } from "./friend-inbox-types.js";

interface TestIdentity {
  rootSignPublicKeyB64: string;
  rootSignPrivateKey: KeyObject;
  encryptionPublicKeyB64: string;
  encryptionPrivateKeyB64: string;
}

function makeIdentity(): TestIdentity {
  const ed = generateKeyPairSync("ed25519");
  const x = generateKeyPairSync("x25519");
  const edPub = (ed.publicKey.export({ format: "jwk" }) as { x?: string }).x;
  const xPub = (x.publicKey.export({ format: "jwk" }) as { x?: string }).x;
  const xPriv = (x.privateKey.export({ format: "jwk" }) as { d?: string }).d;
  if (!edPub || !xPub || !xPriv) throw new Error("jwk export missing fields");
  return {
    rootSignPublicKeyB64: edPub,
    rootSignPrivateKey: ed.privateKey,
    encryptionPublicKeyB64: xPub,
    encryptionPrivateKeyB64: xPriv,
  };
}

function makeEnvelope(sender: TestIdentity, recipient: TestIdentity, body: string) {
  const roomId = p2pRoomId({
    aRootPubKey: sender.rootSignPublicKeyB64,
    bRootPubKey: recipient.rootSignPublicKeyB64,
  });
  return buildFriendChatMessageEnvelope({
    roomId,
    message: {
      id: "fcm_test",
      roomId,
      authorAgentId: `human:${sender.rootSignPublicKeyB64.slice(0, 12)}`,
      body,
      replyToMessageId: null,
      mentionAgentIds: [],
      createdAt: "2026-05-07T03:00:00.000Z",
      clientMessageId: "cm_test",
      authorRootPubKey: sender.rootSignPublicKeyB64,
      authorDeviceId: "srv_sender_test",
      kind: "text",
    },
    authorRootSignPrivateKey: sender.rootSignPrivateKey,
  });
}

describe("encryptInboxBlob / decryptInboxBlob — Phase 3.b/2c", () => {
  test("happy path: sender encrypts, recipient decrypts to same envelope", () => {
    const sender = makeIdentity();
    const recipient = makeIdentity();
    const envelope = makeEnvelope(sender, recipient, "hello from offline path");

    const { blob, serializedBlob } = encryptInboxBlob({
      envelope,
      recipientEncryptionPublicKeyB64: recipient.encryptionPublicKeyB64,
    });

    // Wire shape passes its own zod schema.
    expect(InboxBlobSchema.safeParse(blob).success).toBe(true);
    expect(blob.v).toBe(1);
    expect(blob.ephPublicKeyB64.length).toBeGreaterThan(0);
    expect(blob.ciphertextB64.length).toBeGreaterThan(0);

    const decrypted = decryptInboxBlob({
      blob: serializedBlob,
      selfEncryptionPrivateKeyB64: recipient.encryptionPrivateKeyB64,
    });
    expect(decrypted.ok).toBe(true);
    if (!decrypted.ok) return;
    expect(decrypted.envelope.message.body).toBe("hello from offline path");
    expect(decrypted.envelope.message.authorRootPubKey).toBe(sender.rootSignPublicKeyB64);
    // Signature survives roundtrip — offline-inbox encryption must NOT
    // mutate the envelope.
    expect(decrypted.envelope.authorSignatureB64).toBe(envelope.authorSignatureB64);
  });

  test("each call generates a fresh ephemeral keypair (no reuse)", () => {
    const sender = makeIdentity();
    const recipient = makeIdentity();
    const envelope = makeEnvelope(sender, recipient, "msg");
    const r1 = encryptInboxBlob({
      envelope,
      recipientEncryptionPublicKeyB64: recipient.encryptionPublicKeyB64,
    });
    const r2 = encryptInboxBlob({
      envelope,
      recipientEncryptionPublicKeyB64: recipient.encryptionPublicKeyB64,
    });
    expect(r1.blob.ephPublicKeyB64).not.toBe(r2.blob.ephPublicKeyB64);
    // Different ephemeral key → different shared key → different
    // ciphertext, even though the plaintext envelope is identical.
    expect(r1.blob.ciphertextB64).not.toBe(r2.blob.ciphertextB64);
  });

  test("decrypt with wrong recipient privkey fails cleanly (no throw)", () => {
    const sender = makeIdentity();
    const recipient = makeIdentity();
    const attacker = makeIdentity();
    const envelope = makeEnvelope(sender, recipient, "secret");
    const { serializedBlob } = encryptInboxBlob({
      envelope,
      recipientEncryptionPublicKeyB64: recipient.encryptionPublicKeyB64,
    });
    const result = decryptInboxBlob({
      blob: serializedBlob,
      selfEncryptionPrivateKeyB64: attacker.encryptionPrivateKeyB64,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/decrypt/i);
  });

  test("decrypt rejects schema-invalid blob", () => {
    const recipient = makeIdentity();
    const result = decryptInboxBlob({
      blob: JSON.stringify({ v: 1, ephPublicKeyB64: "ok" /* missing ciphertext */ }),
      selfEncryptionPrivateKeyB64: recipient.encryptionPrivateKeyB64,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/schema invalid/i);
  });

  test("decrypt rejects non-JSON blob", () => {
    const recipient = makeIdentity();
    const result = decryptInboxBlob({
      blob: "not valid json {",
      selfEncryptionPrivateKeyB64: recipient.encryptionPrivateKeyB64,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/json/i);
  });

  test("decrypt accepts already-parsed object (not just string)", () => {
    const sender = makeIdentity();
    const recipient = makeIdentity();
    const envelope = makeEnvelope(sender, recipient, "obj path");
    const { blob } = encryptInboxBlob({
      envelope,
      recipientEncryptionPublicKeyB64: recipient.encryptionPublicKeyB64,
    });
    const result = decryptInboxBlob({
      blob, // pass the parsed object directly, no JSON.stringify
      selfEncryptionPrivateKeyB64: recipient.encryptionPrivateKeyB64,
    });
    expect(result.ok).toBe(true);
  });

  test("encrypt rejects empty recipient pubkey", () => {
    const sender = makeIdentity();
    const recipient = makeIdentity();
    const envelope = makeEnvelope(sender, recipient, "x");
    expect(() => encryptInboxBlob({ envelope, recipientEncryptionPublicKeyB64: "" })).toThrow(
      /empty/i,
    );
  });
});

// Suppress lint warning about unused import — kept for parity with the
// other identity tests that hand-build envelopes.
void nodeSign;
