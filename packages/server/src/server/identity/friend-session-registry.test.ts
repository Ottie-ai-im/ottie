import { describe, expect, test } from "vitest";

import {
  FriendSessionRegistry,
  type FriendSession,
  type FriendSessionSocket,
} from "./friend-session-registry.js";

interface FakeSocket extends FriendSessionSocket {
  sent: string[];
  closes: Array<{ code?: number; reason?: string }>;
}

function makeFakeSocket(): FakeSocket {
  const sent: string[] = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  return {
    sent,
    closes,
    send(data) {
      sent.push(data);
    },
    close(code, reason) {
      closes.push({ code, reason });
    },
  };
}

function makeSession(overrides: Partial<FriendSession> = {}): FriendSession {
  return {
    peerRootPubKey: "x".repeat(43),
    peerDeviceId: "srv_bob",
    sharedKey: {} as unknown as FriendSession["sharedKey"],
    socket: makeFakeSocket(),
    establishedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe("FriendSessionRegistry", () => {
  test("add stores by peerRootPubKey and list reflects it", () => {
    const r = new FriendSessionRegistry();
    const s = makeSession();
    expect(r.add(s)).toBeNull();
    expect(r.get(s.peerRootPubKey)).toBe(s);
    expect(r.list()).toEqual([s]);
  });

  test("add replaces existing session for same peer (closes old socket)", () => {
    const r = new FriendSessionRegistry();
    const oldSocket = makeFakeSocket();
    const newSocket = makeFakeSocket();
    const old = makeSession({ socket: oldSocket, establishedAtMs: 1 });
    r.add(old);
    const fresh = makeSession({ socket: newSocket, establishedAtMs: 2 });
    const displaced = r.add(fresh);
    expect(displaced).toBe(old);
    expect(oldSocket.closes[0]?.code).toBe(1008);
    expect(r.get(fresh.peerRootPubKey)).toBe(fresh);
    expect(r.list()).toEqual([fresh]);
  });

  test("multiple peers coexist", () => {
    const r = new FriendSessionRegistry();
    const a = makeSession({ peerRootPubKey: "a".repeat(43) });
    const b = makeSession({ peerRootPubKey: "b".repeat(43) });
    r.add(a);
    r.add(b);
    expect(r.list()).toHaveLength(2);
  });

  test("remove drops the session and returns true", () => {
    const r = new FriendSessionRegistry();
    const s = makeSession();
    r.add(s);
    expect(r.remove(s.peerRootPubKey)).toBe(true);
    expect(r.get(s.peerRootPubKey)).toBeNull();
    expect(r.remove(s.peerRootPubKey)).toBe(false);
  });

  test("closeAll closes every socket and clears the map", () => {
    const r = new FriendSessionRegistry();
    const a = makeSession({ peerRootPubKey: "a".repeat(43) });
    const b = makeSession({ peerRootPubKey: "b".repeat(43) });
    r.add(a);
    r.add(b);
    r.closeAll("test_shutdown");
    expect((a.socket as FakeSocket).closes[0]?.reason).toBe("test_shutdown");
    expect((b.socket as FakeSocket).closes[0]?.reason).toBe("test_shutdown");
    expect(r.list()).toHaveLength(0);
  });
});
