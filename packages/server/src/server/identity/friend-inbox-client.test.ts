import { describe, expect, test, vi } from "vitest";

import { inboxDeleteAuthPayload, inboxFetchAuthPayload, postInbox } from "./friend-inbox-client.js";

describe("postInbox — Phase 3.b/2c", () => {
  test("issues POST to https://{relayEndpoint}/inbox/{recipient} with body", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            seq: "0000000000001234-abcdef0123456789",
            deliveredAt: "2026-05-07T03:00:00.000Z",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    const result = await postInbox({
      relayEndpoint: "relay.example:443",
      recipientRootPubKeyB64Url: "AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555FFF",
      body: "encrypted-blob-bytes",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seq).toBe("0000000000001234-abcdef0123456789");
    expect(result.deliveredAt).toBe("2026-05-07T03:00:00.000Z");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://relay.example:443/inbox/AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555FFF");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("encrypted-blob-bytes");
  });

  test("propagates 4xx response body in error", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "recipient_quota_entries" }), {
          status: 507,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const result = await postInbox({
      relayEndpoint: "relay.example:443",
      recipientRootPubKeyB64Url: "X".repeat(43),
      body: new Uint8Array([1]).buffer,
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(507);
    expect(result.error).toContain("recipient_quota_entries");
  });

  test("returns network-error wrapper when fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed: ECONNREFUSED");
    });
    const result = await postInbox({
      relayEndpoint: "relay.example:443",
      recipientRootPubKeyB64Url: "X".repeat(43),
      body: "x",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(0);
    expect(result.error).toMatch(/network error/i);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  test("rejects 200 response with malformed JSON body", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("not-json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const result = await postInbox({
      relayEndpoint: "relay.example:443",
      recipientRootPubKeyB64Url: "X".repeat(43),
      body: "x",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not valid json/i);
  });

  test("rejects 200 response missing seq or deliveredAt", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ seq: 42 /* wrong type */ }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const result = await postInbox({
      relayEndpoint: "relay.example:443",
      recipientRootPubKeyB64Url: "X".repeat(43),
      body: "x",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/missing seq or deliveredAt/i);
  });
});

describe("auth payload mirrors (must match relay-side strings exactly)", () => {
  test("inboxFetchAuthPayload format is pinned", () => {
    expect(
      inboxFetchAuthPayload({ recipientRootPubKeyB64Url: "AAA", timestampMs: 1700000000000 }),
    ).toBe("ottie-inbox-fetch-v1\nAAA\n1700000000000");
  });

  test("inboxDeleteAuthPayload format is pinned", () => {
    expect(
      inboxDeleteAuthPayload({
        recipientRootPubKeyB64Url: "AAA",
        timestampMs: 1700000000000,
        seq: "0000000000001234-abcdef0123456789",
      }),
    ).toBe("ottie-inbox-delete-v1\nAAA\n1700000000000\n0000000000001234-abcdef0123456789");
  });
});
