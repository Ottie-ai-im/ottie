import fs from "fs/promises";
import path from "path";
import os from "os";

const ottieHome = process.env.OTTIE_HOME || path.join(os.homedir(), ".ottie");
const pluginDir = path.join(ottieHome, "plugins", "codeisland");

await fs.mkdir(pluginDir, { recursive: true });

await fs.writeFile(
  path.join(pluginDir, "package.json"),
  JSON.stringify(
    {
      name: "codeisland",
      version: "1.0.0",
      main: "index.js",
    },
    null,
    2
  )
);

await fs.writeFile(
  path.join(pluginDir, "index.js"),
  `
import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Helper to send message to CodeIsland unix socket
async function sendToCodeIsland(message) {
  const socketPath = path.join(os.tmpdir(), "codeisland.sock");
  try {
    await fs.access(socketPath);
  } catch {
    return; // CodeIsland not running
  }
  
  return new Promise((resolve) => {
    const client = net.createConnection(socketPath);
    client.on('error', () => resolve());
    client.on('connect', () => {
      client.write(JSON.stringify(message) + "\\n");
      client.end();
      resolve();
    });
  });
}

export function activate(api) {
  api.logger.info("CodeIsland Plugin Activated");

  api.events.on("message", (msg) => {
    if (msg.type === "agent_stream") {
       sendToCodeIsland({
         type: "stream",
         agentId: msg.payload.agentId,
         delta: msg.payload.delta
       });
    } else if (msg.type === "agent_update") {
       sendToCodeIsland({
         type: "update",
         agentId: msg.payload.agentId,
         status: msg.payload.status
       });
    }
  });
}
`
);

console.log("CodeIsland plugin seeded into:", pluginDir);
