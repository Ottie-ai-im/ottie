import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import type { HermesModel } from "./rpc-schemas.js";

const DEFAULT_HOST = "http://127.0.0.1:8642";
const DEFAULT_MODEL = "hermes-agent";
const REQUEST_TIMEOUT_MS = 90_000;

function diag(level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) {
  const line = fields ? `[hermes] ${msg} ${JSON.stringify(fields)}` : `[hermes] ${msg}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Resolve the Hermes API key. Lookup order:
 *   1. `HERMES_API_KEY` env var
 *   2. `API_SERVER_KEY` field in `~/.hermes/.env`
 *   3. "change-me-local-dev" (Hermes default for local dev)
 */
export async function resolveHermesApiKey(): Promise<string> {
  if (process.env.HERMES_API_KEY) {
    diag("info", "API key resolved from HERMES_API_KEY env var");
    return process.env.HERMES_API_KEY.trim();
  }
  const envFile = path.join(os.homedir(), ".hermes", ".env");
  try {
    const raw = await fs.readFile(envFile, "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^API_SERVER_KEY\s*=\s*(.+)$/);
      if (match) {
        const key = match[1].trim().replace(/^["']|["']$/g, "");
        if (key) {
          diag("info", "API key resolved from ~/.hermes/.env");
          return key;
        }
      }
    }
  } catch {
    diag("info", "no ~/.hermes/.env found, using default dev key");
  }
  return "change-me-local-dev";
}

/**
 * List models/agents available from the Hermes API server.
 * Calls GET /v1/models — returns the `id` of each entry.
 */
export async function listHermesModels(host?: string): Promise<HermesModel[]> {
  const base = host ?? DEFAULT_HOST;
  const apiKey = await resolveHermesApiKey();
  const url = `${base}/v1/models`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Hermes /v1/models returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as { data?: unknown[] };
    const data = body.data;
    if (!Array.isArray(data)) return [];
    return data
      .map((item): HermesModel | null => {
        if (!item || typeof item !== "object") return null;
        const rec = item as Record<string, unknown>;
        const id = typeof rec.id === "string" ? rec.id.trim() : "";
        if (!id) return null;
        return { id, label: id };
      })
      .filter((m): m is HermesModel => m !== null);
  } finally {
    clearTimeout(timer);
  }
}

export interface HermesSendOptions {
  text: string;
  modelId?: string | null;
  host?: string;
}

export interface HermesSendResult {
  reply: string;
}

/**
 * Send a chat message to Hermes via POST /v1/chat/completions with SSE streaming.
 * Accumulates the streamed delta content and returns the full reply.
 */
export async function sendHermesMessage(opts: HermesSendOptions): Promise<HermesSendResult> {
  const base = opts.host ?? DEFAULT_HOST;
  const apiKey = await resolveHermesApiKey();
  const model = opts.modelId?.trim() || DEFAULT_MODEL;
  const url = `${base}/v1/chat/completions`;

  diag("info", "sending message", { model, textLength: opts.text.length });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: opts.text }],
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Hermes API returned HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    if (!res.body) throw new Error("Hermes API returned empty body");

    const reply = await consumeSseStream(res.body);
    diag("info", "got reply", { replyLength: reply.length });
    return { reply };
  } finally {
    clearTimeout(timer);
  }
}

function extractSseDeltaContent(data: string): string {
  try {
    const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
    const content = parsed.choices?.[0]?.delta?.content;
    return typeof content === "string" ? content : "";
  } catch {
    return "";
  }
}

async function consumeSseStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const chunks: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice("data: ".length).trim();
        if (data === "[DONE]") break;
        const content = extractSseDeltaContent(data);
        if (content) chunks.push(content);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return chunks.join("");
}
