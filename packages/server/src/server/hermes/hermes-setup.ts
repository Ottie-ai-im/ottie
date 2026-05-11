import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const HERMES_HOME = path.join(os.homedir(), ".hermes");
const CONFIG_PATH = path.join(HERMES_HOME, "config.yaml");
const ENV_PATH = path.join(HERMES_HOME, ".env");
const GATEWAY_PID_PATH = path.join(HERMES_HOME, "gateway.pid");

const HERMES_BIN_CANDIDATES = [
  path.join(HERMES_HOME, "hermes-agent", ".venv", "bin", "hermes"),
  path.join(HERMES_HOME, "bin", "hermes"),
];

export interface HermesSetupState {
  installed: boolean;
  configured: boolean;
  provider: string | null;
  model: string | null;
}

async function findHermesBin(): Promise<string | null> {
  for (const candidate of HERMES_BIN_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
}

async function readYamlField(yaml: string, ...keyPath: string[]): Promise<string | null> {
  const lines = yaml.split("\n");
  let depth = 0;
  const target = keyPath;
  let matched = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    if (matched < target.length && key === target[matched] && indent === matched * 2) {
      matched++;
      depth = indent;
      if (matched === target.length && value) return value.replace(/^["']|["']$/g, "");
    } else if (indent <= depth && matched > 0 && matched < target.length) {
      matched = 0;
    }
  }
  return null;
}

export async function checkHermesSetup(): Promise<HermesSetupState> {
  const installed = !!(await findHermesBin());
  if (!installed) return { installed: false, configured: false, provider: null, model: null };

  let yaml: string;
  try {
    yaml = await fs.readFile(CONFIG_PATH, "utf8");
  } catch {
    return { installed: true, configured: false, provider: null, model: null };
  }

  const provider = await readYamlField(yaml, "model", "provider");
  const model = await readYamlField(yaml, "model", "default");
  return {
    installed: true,
    configured: !!(provider && model),
    provider,
    model,
  };
}

function runCommand(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => chunks.push(d));
    child.on("close", (code) => {
      const out = Buffer.concat(chunks).toString().trim();
      if (code === 0) resolve(out);
      else reject(new Error(out || `exit code ${code}`));
    });
    child.on("error", reject);
  });
}

async function upsertEnvVar(key: string, value: string): Promise<void> {
  let content = "";
  try {
    content = await fs.readFile(ENV_PATH, "utf8");
  } catch {
    // file doesn't exist yet
  }
  const lines = content.split("\n").filter((l) => !l.startsWith(`${key}=`) && l !== "");
  lines.push(`${key}=${value}`);
  await fs.writeFile(ENV_PATH, lines.join("\n") + "\n", "utf8");
}

async function restartGateway(bin: string): Promise<void> {
  // Kill existing gateway via pid file
  try {
    const pid = parseInt(await fs.readFile(GATEWAY_PID_PATH, "utf8"), 10);
    if (pid && !isNaN(pid)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already dead
      }
    }
  } catch {
    // no pid file
  }

  // Wait briefly for old process to die
  await new Promise((r) => setTimeout(r, 500));

  // Start new gateway (fire and forget — it writes its own pid file)
  const child = spawn(bin, ["gateway", "run"], {
    env: { ...process.env },
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

export interface HermesConfigureInput {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export async function configureHermes(input: HermesConfigureInput): Promise<void> {
  const bin = await findHermesBin();
  if (!bin) throw new Error("Hermes is not installed — binary not found");

  await runCommand(bin, ["config", "set", "model.provider", input.provider]);
  await runCommand(bin, ["config", "set", "model.default", input.model]);

  if (input.baseUrl) {
    await runCommand(bin, ["config", "set", "model.base_url", input.baseUrl]);
  }

  const envKeyMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  };

  const envKey = envKeyMap[input.provider];
  if (envKey && input.apiKey) {
    await upsertEnvVar(envKey, input.apiKey);
  }

  if (input.provider === "ollama" && input.baseUrl) {
    await runCommand(bin, ["config", "set", "model.base_url", input.baseUrl]);
  }

  await restartGateway(bin);
}
