import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";

/**
 * Minimal in-process Cloudflare-relay clone for tests. Implements just
 * the V2 routing surface that `relay-transport.ts` and the device-link
 * handshake actually use:
 *
 *   - role=server (no connectionId)        → daemon control socket
 *   - role=server&connectionId=X           → daemon per-connection data socket
 *   - role=client&connectionId=X           → client side of connectionId X
 *
 * On client connect, notifies the matching daemon's control socket with
 * `{type:"connected", connectionId:X}`. Buffers client→server frames if
 * the daemon hasn't opened the data socket yet, replays them on connect.
 *
 * Not modeled (deliberately):
 *   - V1 protocol
 *   - Hibernation, DO state, attachments
 *   - Stale-control nudging timers
 *   - Legacy server-control "stuck" detection
 *
 * Enough to drive Phase 2 device-linking through real WebSockets without
 * dragging in wrangler-dev or real Cloudflare networking.
 */
export class MockRelay {
  private readonly httpServer: HttpServer;
  private readonly wss: WebSocketServer;

  /** serverId → control socket (one per serverId). */
  private controls = new Map<string, WebSocket>();
  /** `{serverId}|{connectionId}` → daemon data socket. */
  private serverData = new Map<string, WebSocket>();
  /** `{serverId}|{connectionId}` → set of client sockets. */
  private clients = new Map<string, Set<WebSocket>>();
  /** Frames buffered for connectionIds whose daemon data socket hasn't opened yet. */
  private pendingFrames = new Map<string, Array<{ frame: string | Buffer; isBinary: boolean }>>();

  constructor() {
    this.httpServer = createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (ws, req) => this.handleConnection(ws, req.url ?? "/"));
  }

  async start(): Promise<{ host: string; port: number }> {
    return new Promise((resolve) => {
      this.httpServer.listen(0, "127.0.0.1", () => {
        const addr = this.httpServer.address() as AddressInfo;
        resolve({ host: "127.0.0.1", port: addr.port });
      });
    });
  }

  endpoint(): string {
    const addr = this.httpServer.address() as AddressInfo;
    return `127.0.0.1:${addr.port}`;
  }

  async stop(): Promise<void> {
    for (const ws of this.controls.values()) ws.close();
    for (const ws of this.serverData.values()) ws.close();
    for (const set of this.clients.values()) for (const ws of set) ws.close();
    this.controls.clear();
    this.serverData.clear();
    this.clients.clear();
    this.pendingFrames.clear();
    await new Promise<void>((resolve) => {
      this.wss.close(() => {
        this.httpServer.close(() => resolve());
      });
    });
  }

  private handleConnection(ws: WebSocket, urlPath: string): void {
    const url = new URL(urlPath, "http://localhost");
    const role = url.searchParams.get("role");
    const serverId = url.searchParams.get("serverId");
    const connectionId = (url.searchParams.get("connectionId") ?? "").trim();
    const v = url.searchParams.get("v") ?? "1";

    if (v !== "2") {
      ws.close(1008, "MockRelay only supports v=2");
      return;
    }
    if (!role || (role !== "server" && role !== "client")) {
      ws.close(1008, "missing role");
      return;
    }
    if (!serverId) {
      ws.close(1008, "missing serverId");
      return;
    }

    if (role === "server" && !connectionId) {
      this.acceptServerControl(ws, serverId);
      return;
    }
    if (role === "server" && connectionId) {
      this.acceptServerData(ws, serverId, connectionId);
      return;
    }
    if (role === "client" && connectionId) {
      this.acceptClient(ws, serverId, connectionId);
      return;
    }
    ws.close(1008, "unrecognized role/connectionId combination");
  }

  private acceptServerControl(ws: WebSocket, serverId: string): void {
    const existing = this.controls.get(serverId);
    if (existing) existing.close(1008, "Replaced");
    this.controls.set(serverId, ws);
    const known = Array.from(this.clients.keys())
      .filter((k) => k.startsWith(`${serverId}|`))
      .map((k) => k.slice(serverId.length + 1));
    try {
      ws.send(JSON.stringify({ type: "sync", connectionIds: known }));
    } catch {
      // ignore
    }
    ws.on("message", (raw) => this.handleControlMessage(ws, raw));
    ws.on("close", () => {
      if (this.controls.get(serverId) === ws) this.controls.delete(serverId);
    });
  }

  private acceptServerData(ws: WebSocket, serverId: string, connectionId: string): void {
    const key = makeKey(serverId, connectionId);
    const existing = this.serverData.get(key);
    if (existing) existing.close(1008, "Replaced");
    this.serverData.set(key, ws);

    const buffered = this.pendingFrames.get(key) ?? [];
    this.pendingFrames.delete(key);
    for (const entry of buffered) {
      try {
        ws.send(entry.frame, { binary: entry.isBinary });
      } catch {
        // ignore
      }
    }

    ws.on("message", (raw, isBinary) =>
      this.forwardServerToClient(serverId, connectionId, raw, isBinary),
    );
    ws.on("close", () => {
      if (this.serverData.get(key) === ws) this.serverData.delete(key);
    });
  }

  private acceptClient(ws: WebSocket, serverId: string, connectionId: string): void {
    const key = makeKey(serverId, connectionId);
    const set = this.clients.get(key) ?? new Set();
    set.add(ws);
    this.clients.set(key, set);

    this.notifyControl(serverId, { type: "connected", connectionId });

    ws.on("message", (raw, isBinary) =>
      this.forwardClientToServer(serverId, connectionId, raw, isBinary),
    );
    ws.on("close", () => {
      const live = this.clients.get(key);
      if (live) {
        live.delete(ws);
        if (live.size === 0) this.clients.delete(key);
      }
      this.notifyControl(serverId, { type: "disconnected", connectionId });
    });
  }

  private notifyControl(serverId: string, message: unknown): void {
    const control = this.controls.get(serverId);
    if (!control || control.readyState !== control.OPEN) return;
    try {
      control.send(JSON.stringify(message));
    } catch {
      // ignore
    }
  }

  private handleControlMessage(ws: WebSocket, raw: unknown): void {
    if (typeof raw !== "string" && !Buffer.isBuffer(raw)) return;
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    try {
      const parsed = JSON.parse(text);
      if (parsed?.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
      }
    } catch {
      // ignore non-JSON control messages
    }
  }

  private forwardClientToServer(
    serverId: string,
    connectionId: string,
    raw: unknown,
    isBinary: boolean,
  ): void {
    const key = makeKey(serverId, connectionId);
    const target = this.serverData.get(key);
    const frame = normalizeFrame(raw, isBinary);
    if (frame === null) return;

    if (target && target.readyState === target.OPEN) {
      try {
        target.send(frame, { binary: isBinary });
      } catch {
        // ignore
      }
      return;
    }
    // Daemon hasn't opened the data socket yet — buffer.
    const buffer = this.pendingFrames.get(key) ?? [];
    buffer.push({ frame, isBinary });
    this.pendingFrames.set(key, buffer);
  }

  private forwardServerToClient(
    serverId: string,
    connectionId: string,
    raw: unknown,
    isBinary: boolean,
  ): void {
    const key = makeKey(serverId, connectionId);
    const targets = this.clients.get(key);
    if (!targets) return;
    const frame = normalizeFrame(raw, isBinary);
    if (frame === null) return;
    for (const target of targets) {
      if (target.readyState !== target.OPEN) continue;
      try {
        target.send(frame, { binary: isBinary });
      } catch {
        // ignore
      }
    }
  }
}

function makeKey(serverId: string, connectionId: string): string {
  return `${serverId}|${connectionId}`;
}

/**
 * Convert ws's incoming `data` argument into the right outbound shape.
 * Critically: when `isBinary` is false (a text frame), the receiver
 * library still gives a Buffer — we need to convert back to string so
 * the relay re-sends as a text frame, not as a binary one.
 */
function normalizeFrame(raw: unknown, isBinary: boolean): string | Buffer | null {
  if (Buffer.isBuffer(raw)) return isBinary ? raw : raw.toString("utf8");
  if (typeof raw === "string") return raw;
  if (raw instanceof ArrayBuffer) {
    const buf = Buffer.from(raw);
    return isBinary ? buf : buf.toString("utf8");
  }
  if (Array.isArray(raw)) {
    const buffers = raw.filter((b): b is Buffer => Buffer.isBuffer(b));
    if (buffers.length === raw.length) {
      const concat = Buffer.concat(buffers);
      return isBinary ? concat : concat.toString("utf8");
    }
  }
  return null;
}
