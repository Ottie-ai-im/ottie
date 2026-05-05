import { setTimeout as delay } from "node:timers/promises";

export type LocalServiceId = "open-webui" | "openclaw" | "hermes";

export interface LocalServiceProbe {
  id: LocalServiceId;
  label: string;
  defaultPort: number;
  fallbackPort: number;
  healthPath: string;
}

const PROBES: LocalServiceProbe[] = [
  {
    id: "open-webui",
    label: "Open WebUI",
    defaultPort: 3000,
    fallbackPort: 13000,
    healthPath: "/health",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    defaultPort: 18789,
    fallbackPort: 18790,
    healthPath: "/",
  },
  {
    id: "hermes",
    label: "Hermes Agent",
    defaultPort: 8080,
    fallbackPort: 18081,
    healthPath: "/",
  },
];

export interface LocalServiceStatus {
  id: LocalServiceId;
  label: string;
  running: boolean;
  port: number | null;
  url: string | null;
  /**
   * RTT in ms for the successful probe. Useful for surfacing "is this thing
   * responsive" without forcing the client to time it.
   */
  responseTimeMs: number | null;
}

const PROBE_TIMEOUT_MS = 1500;

async function probePort(port: number, healthPath: string): Promise<number | null> {
  const url = `http://127.0.0.1:${port}${healthPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    // HEAD first — many dashboards reject it; fall back to GET.
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      // Tell undici not to follow redirects so we don't accidentally probe
      // somewhere unexpected.
      redirect: "manual",
    });
    // Anything 2xx/3xx counts as "something's there". 4xx too — even a 404
    // means the port is bound and answering HTTP, which is what we care about.
    if (response.status > 0 && response.status < 600) {
      return Date.now() - startedAt;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeService(probe: LocalServiceProbe): Promise<LocalServiceStatus> {
  for (const port of [probe.defaultPort, probe.fallbackPort]) {
    const rtt = await probePort(port, probe.healthPath);
    if (rtt !== null) {
      return {
        id: probe.id,
        label: probe.label,
        running: true,
        port,
        url: `http://127.0.0.1:${port}`,
        responseTimeMs: rtt,
      };
    }
  }
  return {
    id: probe.id,
    label: probe.label,
    running: false,
    port: null,
    url: null,
    responseTimeMs: null,
  };
}

export async function listLocalServices(): Promise<LocalServiceStatus[]> {
  // Run probes in parallel; each one self-times out at 1.5s so the whole
  // call returns within ~1.5s even if everything is unreachable.
  const promises = PROBES.map((probe) =>
    Promise.race([probeService(probe), delay(PROBE_TIMEOUT_MS + 200).then(() => null)]).then(
      (result) =>
        result ?? {
          id: probe.id,
          label: probe.label,
          running: false,
          port: null,
          url: null,
          responseTimeMs: null,
        },
    ),
  );
  return Promise.all(promises);
}
