<p align="center">
  <img src="packages/desktop/src-tauri/icons/icon.png" width="120" alt="Ottie">
</p>

<h1 align="center">Ottie</h1>

<p align="center">
  <b>The Universal Entrypoint for the AI Era: Connect Humans, Devices, and Agents in a Single Conversation.</b>
</p>

<p align="center">
  English | <a href="README.zh-CN.md">中文</a>
</p>

---

Ottie is a distributed orchestration protocol and an IM-based operating system. We believe the ultimate interface for intelligence is not a dashboard, but a simple, persistent, and ubiquitous conversation that bridges the gap between local hardware, cloud AI, and human collaboration.

---

## 🌟 The Vision: IM as the Interface for Everything

In Ottie, the "Chat Room" is a **shared context container**. It transforms traditional instant messaging into a universal control surface:

- **Universal Entrypoint:** One interface to rule them all. Control your local agents, cloud models, and remote devices without switching apps.
- **Cross-Device Mesh:** Orchestrate your **PC** from your **Phone**, or tap into your **Phone's** sensors from your **PC**. Devices are just "nodes" in your contact list.
- **Intelligence Social Network:** It's not just you talking to AI. It's **AI talking to AI (A2A)**, and **Humans collaborating with AI (H2A)** in a unified social fabric.

---

## 🌐 Three Stages of Interaction

1. **Human-to-AI & Device (Current):** Remote control your local/cloud agents and manage device terminals from your pocket.
2. **AI-to-AI Collaboration (Evolving):** Agents communicate, delegate, and hand off tasks to each other within an Ottie Room.
3. **Multi-Lateral Network (Ultimate Vision):** A collaborative space where multiple humans and multiple agents work together to solve complex problems.

---

## ✨ Features

- 📱 **Native Experience:** High-performance clients for iOS, Android, Web, and Desktop (Tauri).
- 🔌 **Binary Multiplexing:** Custom protocol supporting real-time Terminal PTY data and agent thought streams over a single connection.
- 🛡️ **Ubiquitous & Secure:** Zero-knowledge encrypted Relay allows you to control nodes from anywhere in the world securely.
- 🤖 **Agent First-Class Citizens:** Agents have identities, statuses, and permissions just like human members.

---

## 📱 Screenshots

<p align="center">
  <img src="screenshots/agents.svg" width="220" alt="Agent List">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="screenshots/chat.svg" width="220" alt="Agent Timeline">
</p>

<p align="center">
  <sub>Monitor all running agents &nbsp;·&nbsp; Watch real-time tool calls and output</sub>
</p>

---

## 🏗️ Repository Map

- `packages/server` — The Daemon: Agent lifecycle, WebSocket API, PTY management.
- `packages/app` — Mobile + Web client (Expo).
- `packages/cli` — Docker-style CLI (`ottie run/ls/logs`).
- `packages/desktop` — Tauri v2 desktop shell.
- `packages/relay` — E2E encrypted relay for remote access.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 20+, pnpm 9.x
- Rust toolchain (for Desktop/Tauri)

### Installation

```bash
git clone https://github.com/Wendell-Guan/ottie.git
cd ottie
pnpm install
```

### Running in Dev Mode

```bash
# Start daemon + Expo together
pnpm dev

# Or run Desktop (Tauri)
pnpm dev:desktop
```

---

## 📄 License

[AGPL-3.0](./LICENSE)

---

**Ottie: Connect Humans, Devices, and AI Agents in a Single Conversation.**
