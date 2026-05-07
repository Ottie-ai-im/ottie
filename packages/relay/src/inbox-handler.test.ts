import { generateKeyPairSync, sign as nodeSign } from "node:crypto";

import { describe, expect, it } from "vitest";

import { handleInboxRequest, type InboxKV, type InboxKVList } from "./inbox-handler.js";
import {
  inboxDeleteAuthPayload,
  inboxFetchAuthPayload,
  INBOX_AUTH_TIMESTAMP_WINDOW_MS,
  INBOX_HEADER_RECIPIENT,
  INBOX_HEADER_SIGNATURE,
  INBOX_HEADER_TIMESTAMP,
  INBOX_MAX_BLOB_BYTES,
  INBOX_MAX_BYTES_PER_RECIPIENT,
  INBOX_MAX_ENTRIES_PER_RECIPIENT,
  type InboxFetchResponseBody,
  type InboxPostResponseBody,
} from "./inbox-types.js";

// ----- in-memory KV mock --------------------------------------------------

function createMockKV(): InboxKV & { dump: () => Map<string, ArrayBuffer | string> } {
  const store = new Map<string, ArrayBuffer | string>();
  return {
    async get(key: string, type: "arrayBuffer" | "text"): Promise<ArrayBuffer & string & null> {
      const v = store.get(key);
      if (v === undefined) return null as never;
      if (type === "arrayBuffer") return (typeof v === "string" ? null : v) as never;
      return (typeof v === "string" ? v : null) as never;
    },
    async put(key: string, value: ArrayBuffer | string): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list(options?: { prefix?: string; limit?: number }): Promise<InboxKVList> {
      const prefix = options?.prefix ?? "";
      const limit = options?.limit ?? 100;
      const matching = [...store.keys()]
        .filter((k) => k.startsWith(prefix) && !k.startsWith("inbox:meta:"))
        .sort();
      const page = matching.slice(0, limit);
      return {
        keys: page.map((name) => ({ name })),
        list_complete: page.length === matching.length,
      };
    },
    dump: () => store,
  };
}

// ----- Ed25519 test identity ---------------------------------------------

interface TestIdentity {
  pubKeyB64Url: string; // 32-byte base64url
  sign: (payload: string) => string; // 64-byte sig base64url
}

function makeIdentity(): TestIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubJwk = publicKey.export({ format: "jwk" }) as { x?: string };
  if (!pubJwk.x) throw new Error("no x");
  return {
    pubKeyB64Url: pubJwk.x,
    sign: (payload) => {
      const buf = nodeSign(null, Buffer.from(payload, "utf8"), privateKey);
      return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    },
  };
}

function signedHeaders(args: {
  recipient: string;
  payload: string;
  identity: TestIdentity;
  timestampMs: number;
}): Record<string, string> {
  return {
    [INBOX_HEADER_RECIPIENT]: args.recipient,
    [INBOX_HEADER_TIMESTAMP]: String(args.timestampMs),
    [INBOX_HEADER_SIGNATURE]: args.identity.sign(args.payload),
  };
}

// ----- helpers ------------------------------------------------------------

function makeRequest(args: {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: ArrayBuffer | string | null;
}): { request: Request; url: URL } {
  const url = new URL(`https://relay.example${args.path}`);
  const init: RequestInit = {
    method: args.method,
    headers: args.headers ?? {},
  };
  if (args.body !== undefined && args.body !== null) {
    init.body = args.body;
  }
  return { request: new Request(url.toString(), init), url };
}

// ----- tests --------------------------------------------------------------

describe("handleInboxRequest — Phase 3.b/2b", () => {
  describe("path matching", () => {
    it("returns null when URL is not under /inbox/", async () => {
      const inbox = createMockKV();
      const { request, url } = makeRequest({ method: "POST", path: "/health" });
      const result = await handleInboxRequest(request, url, { inbox });
      expect(result).toBeNull();
    });

    it("rejects /inbox by itself (no recipient)", async () => {
      const inbox = createMockKV();
      const { request, url } = makeRequest({ method: "POST", path: "/inbox/" });
      const result = await handleInboxRequest(request, url, { inbox });
      expect(result?.status).toBe(404);
    });

    it("rejects malformed recipient pubkeys", async () => {
      const inbox = createMockKV();
      const { request, url } = makeRequest({ method: "POST", path: "/inbox/short" });
      const result = await handleInboxRequest(request, url, { inbox });
      expect(result?.status).toBe(400);
      const body = (await result?.json()) as { error: string };
      expect(body.error).toBe("invalid_recipient");
    });

    it("405s on unsupported method/path combos", async () => {
      const inbox = createMockKV();
      const id = makeIdentity();
      const { request, url } = makeRequest({ method: "PUT", path: `/inbox/${id.pubKeyB64Url}` });
      const result = await handleInboxRequest(request, url, { inbox });
      expect(result?.status).toBe(405);
    });
  });

  describe("POST /inbox/:recipient", () => {
    it("stores blob, returns seq + deliveredAt, increments meta", async () => {
      const inbox = createMockKV();
      const id = makeIdentity();
      const blob = new Uint8Array([1, 2, 3, 4, 5]).buffer;
      const { request, url } = makeRequest({
        method: "POST",
        path: `/inbox/${id.pubKeyB64Url}`,
        body: blob,
      });
      const fixedNow = 1_700_000_000_000;
      const result = await handleInboxRequest(request, url, {
        inbox,
        nowMs: () => fixedNow,
      });
      expect(result?.status).toBe(200);
      const body = (await result?.json()) as InboxPostResponseBody;
      expect(body.seq).toMatch(/^[0-9]{16}-[0-9a-f]{16}$/);
      expect(body.deliveredAt).toBe(new Date(fixedNow).toISOString());
      // KV holds the entry under inbox:msg:<recipient>:<seq>
      const stored = inbox.dump();
      const entryKey = [...stored.keys()].find((k) =>
        k.startsWith(`inbox:msg:${id.pubKeyB64Url}:`),
      );
      expect(entryKey).toBeDefined();
      // Meta reflects the write.
      const metaRaw = stored.get(`inbox:meta:${id.pubKeyB64Url}`);
      expect(typeof metaRaw).toBe("string");
      expect(JSON.parse(metaRaw as string)).toEqual({
        entryCount: 1,
        totalBytes: 5,
        lastDeliveredAt: new Date(fixedNow).toISOString(),
      });
    });

    it("rejects empty body", async () => {
      const inbox = createMockKV();
      const id = makeIdentity();
      const { request, url } = makeRequest({
        method: "POST",
        path: `/inbox/${id.pubKeyB64Url}`,
      });
      const result = await handleInboxRequest(request, url, { inbox });
      expect(result?.status).toBe(400);
    });

    it("rejects oversize blob with 413", async () => {
      const inbox = createMockKV();
      const id = makeIdentity();
      const big = new Uint8Array(INBOX_MAX_BLOB_BYTES + 1).buffer;
      const { request, url } = makeRequest({
        method: "POST",
        path: `/inbox/${id.pubKeyB64Url}`,
        body: big,
      });
      const result = await handleInboxRequest(request, url, { inbox });
      expect(result?.status).toBe(413);
    });

    it("rejects with 507 once per-recipient entry quota is exceeded", async () => {
      const inbox = createMockKV();
      const id = makeIdentity();
      // Pre-stuff meta near the cap.
      await inbox.put(
        `inbox:meta:${id.pubKeyB64Url}`,
        JSON.stringify({
          entryCount: INBOX_MAX_ENTRIES_PER_RECIPIENT,
          totalBytes: 0,
          lastDeliveredAt: "",
        }),
      );
      const { request, url } = makeRequest({
        method: "POST",
        path: `/inbox/${id.pubKeyB64Url}`,
        body: new Uint8Array([1]).buffer,
      });
      const result = await handleInboxRequest(request, url, { inbox });
      expect(result?.status).toBe(507);
      const body = (await result?.json()) as { error: string };
      expect(body.error).toBe("recipient_quota_entries");
    });

    it("rejects with 507 once per-recipient byte quota is exceeded", async () => {
      const inbox = createMockKV();
      const id = makeIdentity();
      await inbox.put(
        `inbox:meta:${id.pubKeyB64Url}`,
        JSON.stringify({
          entryCount: 1,
          totalBytes: INBOX_MAX_BYTES_PER_RECIPIENT,
          lastDeliveredAt: "",
        }),
      );
      const { request, url } = makeRequest({
        method: "POST",
        path: `/inbox/${id.pubKeyB64Url}`,
        body: new Uint8Array([1]).buffer,
      });
      const result = await handleInboxRequest(request, url, { inbox });
      expect(result?.status).toBe(507);
    });
  });

  describe("GET /inbox/:recipient", () => {
    it("rejects without auth headers (401)", async () => {
      const inbox = createMockKV();
      const id = makeIdentity();
      const { request, url } = makeRequest({
        method: "GET",
        path: `/inbox/${id.pubKeyB64Url}`,
      });
      const result = await handleInboxRequest(request, url, { inbox });
      expect(result?.status).toBe(401);
    });

    it("rejects with stale timestamp (410)", async () => {
      const inbox = createMockKV();
      const id = makeIdentity();
      const fixedNow = 1_700_000_000_000;
      const stale = fixedNow - INBOX_AUTH_TIMESTAMP_WINDOW_MS - 1000;
      const headers = signedHeaders({
        recipient: id.pubKeyB64Url,
        payload: inboxFetchAuthPayload({
          recipientRootPubKeyB64Url: id.pubKeyB64Url,
          timestampMs: stale,
        }),
        identity: id,
        timestampMs: stale,
      });
      const { request, url } = makeRequest({
        method: "GET",
        path: `/inbox/${id.pubKeyB64Url}`,
        headers,
      });
      const result = await handleInboxRequest(request, url, { inbox, nowMs: () => fixedNow });
      expect(result?.status).toBe(410);
    });

    it("rejects with bad signature (401)", async () => {
      const inbox = createMockKV();
      const id = makeIdentity();
      const fixedNow = 1_700_000_000_000;
      const headers = signedHeaders({
        recipient: id.pubKeyB64Url,
        payload: "wrong-payload",
        identity: id,
        timestampMs: fixedNow,
      });
      const { request, url } = makeRequest({
        method: "GET",
        path: `/inbox/${id.pubKeyB64Url}`,
        headers,
      });
      const result = await handleInboxRequest(request, url, { inbox, nowMs: () => fixedNow });
      expect(result?.status).toBe(401);
    });

    it("rejects when header recipient mismatches URL recipient", async () => {
      const inbox = createMockKV();
      const id = makeIdentity();
      const other = makeIdentity();
      const fixedNow = 1_700_000_000_000;
      const headers = {
        [INBOX_HEADER_RECIPIENT]: other.pubKeyB64Url,
        [INBOX_HEADER_TIMESTAMP]: String(fixedNow),
        [INBOX_HEADER_SIGNATURE]: id.sign("anything"),
      };
      const { request, url } = makeRequest({
        method: "GET",
        path: `/inbox/${id.pubKeyB64Url}`,
        headers,
      });
      const result = await handleInboxRequest(request, url, { inbox, nowMs: () => fixedNow });
      expect(result?.status).toBe(401);
    });

    it("returns entries with valid auth, oldest-first", async () => {
      const inbox = createMockKV();
      const id = makeIdentity();
      const baseNow = 1_700_000_000_000;
      // Drop three entries via POST
      for (let i = 0; i < 3; i++) {
        const { request: postReq, url: postUrl } = makeRequest({
          method: "POST",
          path: `/inbox/${id.pubKeyB64Url}`,
          body: new Uint8Array([i + 1]).buffer,
        });
        await handleInboxRequest(postReq, postUrl, { inbox, nowMs: () => baseNow + i });
      }
      // Fetch with auth
      const fetchTs = baseNow + 100;
      const headers = signedHeaders({
        recipient: id.pubKeyB64Url,
        payload: inboxFetchAuthPayload({
          recipientRootPubKeyB64Url: id.pubKeyB64Url,
          timestampMs: fetchTs,
        }),
        identity: id,
        timestampMs: fetchTs,
      });
      const { request, url } = makeRequest({
        method: "GET",
        path: `/inbox/${id.pubKeyB64Url}`,
        headers,
      });
      const result = await handleInboxRequest(request, url, { inbox, nowMs: () => fetchTs });
      expect(result?.status).toBe(200);
      const body = (await result?.json()) as InboxFetchResponseBody;
      expect(body.entries).toHaveLength(3);
      // Oldest-first: each entry's seq's timestamp prefix is non-decreasing.
      const tsPrefixes = body.entries.map((e) => e.seq.slice(0, 16));
      const sorted = [...tsPrefixes].sort();
      expect(tsPrefixes).toEqual(sorted);
      expect(body.nextCursor).toBe(body.entries[body.entries.length - 1]!.seq);
      expect(body.hasMore).toBe(false);
      // Decode the first ciphertext blob → matches the byte we POSTed.
      const firstBlob = Uint8Array.from(atob(body.entries[0]!.ciphertextB64), (c) =>
        c.charCodeAt(0),
      );
      expect(firstBlob).toEqual(new Uint8Array([1]));
    });

    it("?since=cursor skips already-seen entries", async () => {
      const inbox = createMockKV();
      const id = makeIdentity();
      const baseNow = 1_700_000_000_000;
      const seqs: string[] = [];
      for (let i = 0; i < 5; i++) {
        const { request: postReq, url: postUrl } = makeRequest({
          method: "POST",
          path: `/inbox/${id.pubKeyB64Url}`,
          body: new Uint8Array([i + 1]).buffer,
        });
        const r = await handleInboxRequest(postReq, postUrl, { inbox, nowMs: () => baseNow + i });
        const b = (await r?.json()) as InboxPostResponseBody;
        seqs.push(b.seq);
      }
      const cursor = seqs[1]!;
      const fetchTs = baseNow + 100;
      const headers = signedHeaders({
        recipient: id.pubKeyB64Url,
        payload: inboxFetchAuthPayload({
          recipientRootPubKeyB64Url: id.pubKeyB64Url,
          timestampMs: fetchTs,
        }),
        identity: id,
        timestampMs: fetchTs,
      });
      const { request, url } = makeRequest({
        method: "GET",
        path: `/inbox/${id.pubKeyB64Url}?since=${cursor}`,
        headers,
      });
      const result = await handleInboxRequest(request, url, { inbox, nowMs: () => fetchTs });
      expect(result?.status).toBe(200);
      const body = (await result?.json()) as InboxFetchResponseBody;
      // Returns only the 3 entries strictly after seqs[1]
      expect(body.entries.map((e) => e.seq)).toEqual(seqs.slice(2));
    });
  });

  describe("DELETE /inbox/:recipient/:seq", () => {
    it("rejects without auth (401)", async () => {
      const inbox = createMockKV();
      const id = makeIdentity();
      const seq = "0000000000000001-0123456789abcdef";
      const { request, url } = makeRequest({
        method: "DELETE",
        path: `/inbox/${id.pubKeyB64Url}/${seq}`,
      });
      const result = await handleInboxRequest(request, url, { inbox });
      expect(result?.status).toBe(401);
    });

    it("rejects malformed seq (400)", async () => {
      const inbox = createMockKV();
      const id = makeIdentity();
      const fixedNow = 1_700_000_000_000;
      const seq = "not-a-real-seq";
      const headers = signedHeaders({
        recipient: id.pubKeyB64Url,
        payload: inboxDeleteAuthPayload({
          recipientRootPubKeyB64Url: id.pubKeyB64Url,
          timestampMs: fixedNow,
          seq,
        }),
        identity: id,
        timestampMs: fixedNow,
      });
      const { request, url } = makeRequest({
        method: "DELETE",
        path: `/inbox/${id.pubKeyB64Url}/${seq}`,
        headers,
      });
      const result = await handleInboxRequest(request, url, { inbox, nowMs: () => fixedNow });
      expect(result?.status).toBe(400);
    });

    it("removes the entry and shrinks meta", async () => {
      const inbox = createMockKV();
      const id = makeIdentity();
      const baseNow = 1_700_000_000_000;
      // POST one entry, capture its seq.
      const { request: postReq, url: postUrl } = makeRequest({
        method: "POST",
        path: `/inbox/${id.pubKeyB64Url}`,
        body: new Uint8Array([42, 42, 42]).buffer,
      });
      const postRes = await handleInboxRequest(postReq, postUrl, { inbox, nowMs: () => baseNow });
      const postBody = (await postRes?.json()) as InboxPostResponseBody;
      // DELETE it.
      const delTs = baseNow + 1;
      const delHeaders = signedHeaders({
        recipient: id.pubKeyB64Url,
        payload: inboxDeleteAuthPayload({
          recipientRootPubKeyB64Url: id.pubKeyB64Url,
          timestampMs: delTs,
          seq: postBody.seq,
        }),
        identity: id,
        timestampMs: delTs,
      });
      const { request, url } = makeRequest({
        method: "DELETE",
        path: `/inbox/${id.pubKeyB64Url}/${postBody.seq}`,
        headers: delHeaders,
      });
      const result = await handleInboxRequest(request, url, { inbox, nowMs: () => delTs });
      expect(result?.status).toBe(204);
      // Entry gone.
      expect([...inbox.dump().keys()].some((k) => k.startsWith("inbox:msg:"))).toBe(false);
      // Meta shrunk.
      const meta = JSON.parse(inbox.dump().get(`inbox:meta:${id.pubKeyB64Url}`) as string);
      expect(meta.entryCount).toBe(0);
      expect(meta.totalBytes).toBe(0);
    });
  });

  describe("end-to-end roundtrip", () => {
    it("POST 3, GET fetches them, DELETE one, GET no longer returns it", async () => {
      const inbox = createMockKV();
      const id = makeIdentity();
      const baseNow = 1_700_000_000_000;
      const seqs: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { request, url } = makeRequest({
          method: "POST",
          path: `/inbox/${id.pubKeyB64Url}`,
          body: new Uint8Array([i + 1]).buffer,
        });
        const r = await handleInboxRequest(request, url, { inbox, nowMs: () => baseNow + i });
        const body = (await r?.json()) as InboxPostResponseBody;
        seqs.push(body.seq);
      }

      // GET → 3 entries.
      const fetchAuthTs = baseNow + 100;
      const fetchHeaders = signedHeaders({
        recipient: id.pubKeyB64Url,
        payload: inboxFetchAuthPayload({
          recipientRootPubKeyB64Url: id.pubKeyB64Url,
          timestampMs: fetchAuthTs,
        }),
        identity: id,
        timestampMs: fetchAuthTs,
      });
      const { request: get1Req, url: get1Url } = makeRequest({
        method: "GET",
        path: `/inbox/${id.pubKeyB64Url}`,
        headers: fetchHeaders,
      });
      const get1 = await handleInboxRequest(get1Req, get1Url, {
        inbox,
        nowMs: () => fetchAuthTs,
      });
      const get1Body = (await get1?.json()) as InboxFetchResponseBody;
      expect(get1Body.entries.map((e) => e.seq)).toEqual(seqs);

      // DELETE entry 1.
      const delTs = baseNow + 200;
      const delHeaders = signedHeaders({
        recipient: id.pubKeyB64Url,
        payload: inboxDeleteAuthPayload({
          recipientRootPubKeyB64Url: id.pubKeyB64Url,
          timestampMs: delTs,
          seq: seqs[1]!,
        }),
        identity: id,
        timestampMs: delTs,
      });
      const { request: delReq, url: delUrl } = makeRequest({
        method: "DELETE",
        path: `/inbox/${id.pubKeyB64Url}/${seqs[1]}`,
        headers: delHeaders,
      });
      const delRes = await handleInboxRequest(delReq, delUrl, { inbox, nowMs: () => delTs });
      expect(delRes?.status).toBe(204);

      // GET → 2 entries.
      const fetch2Ts = baseNow + 300;
      const fetch2Headers = signedHeaders({
        recipient: id.pubKeyB64Url,
        payload: inboxFetchAuthPayload({
          recipientRootPubKeyB64Url: id.pubKeyB64Url,
          timestampMs: fetch2Ts,
        }),
        identity: id,
        timestampMs: fetch2Ts,
      });
      const { request: get2Req, url: get2Url } = makeRequest({
        method: "GET",
        path: `/inbox/${id.pubKeyB64Url}`,
        headers: fetch2Headers,
      });
      const get2 = await handleInboxRequest(get2Req, get2Url, {
        inbox,
        nowMs: () => fetch2Ts,
      });
      const get2Body = (await get2?.json()) as InboxFetchResponseBody;
      expect(get2Body.entries.map((e) => e.seq)).toEqual([seqs[0], seqs[2]]);
    });
  });
});
