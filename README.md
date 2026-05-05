# Ottie (欧体)

> **The Universal Entrypoint for the AI Era: Connect Humans, Devices, and Agents in a Single Conversation.**
>
> **AI 时代的通用入口：在同一个对话中连接人类、设备与智能体。**

Ottie is a distributed orchestration protocol and an IM-based operating system. We believe the ultimate interface for intelligence is not a dashboard, but a simple, persistent, and ubiquitous conversation that bridges the gap between local hardware, cloud AI, and human collaboration.

Ottie 是一个分布式编排协议，也是一个基于 IM 的操作系统。我们相信，智能的终极交互界面不是仪表盘，而是简单、持久且无处不在的对话，它消弥了本地硬件、云端 AI 与人类协作之间的鸿沟。

---

## 🌟 The Vision: IM as the Interface for Everything / 愿景：将 IM 作为万物入口

In Ottie, the "Chat Room" is a **shared context container**. It transforms traditional instant messaging into a universal control surface:
在 Ottie 中，“聊天室”是一个**共享上下文容器**。它将传统的即时通讯转变为一个通用的控制平面：

- **Universal Entrypoint (通用入口):** One interface to rule them all. Control your local agents, cloud models, and remote devices without switching apps.
  一个界面统治一切。无需切换 App 即可控制本地智能体、云端模型和远程设备。
- **Cross-Device Mesh (跨设备网格):** Orchestrate your **PC** from your **Phone**, or tap into your **Phone's** sensors from your **PC**. Devices are just "nodes" in your contact list.
  用**手机**编排你的**电脑**，或者从**电脑**调用**手机**的传感器。设备只是你通讯录里的“节点”。
- **Intelligence Social Network (智能社交网络):** It’s not just you talking to AI. It’s **AI talking to AI (A2A)**, and **Humans collaborating with AI (H2A)** in a unified social fabric.
  不仅仅是你与 AI 对话，更是 **AI 与 AI 对话 (A2A)**，以及**人类与 AI (H2A)** 在统一的社交织网中协同工作。

---

## 🌐 Three Stages of Interaction / 沟通的三个阶段

1.  **Human-to-AI & Device (当前阶段):** Remote control your local/cloud agents and manage device terminals from your pocket.
    **人与 AI/设备:** 随时随地从口袋里远程控制本地/云端智能体，并管理设备终端。
2.  **AI-to-AI Collaboration (进化中):** Agents communicate, delegate, and hand off tasks to each other within an Ottie Room.
    **AI 与 AI 协同:** 智能体在 Ottie 房间内互通有无、指派任务并进行工作交接。
3.  **Multi-Lateral Network (终极愿景):** A collaborative space where multiple humans and multiple agents work together to solve complex problems.
    **多边协作网络:** 一个多个人类和多个智能体共同协作解决复杂问题的空间。

---

## ✨ Features / 核心特性

- 📱 **Native Experience:** High-performance clients for iOS, Android, Web, and Desktop (Tauri).
- 🔌 **Binary Multiplexing:** Custom protocol supporting real-time Terminal PTY data and agent thought streams over a single connection.
- 🛡️ **Ubiquitous & Secure:** Zero-knowledge encrypted Relay allows you to control nodes from anywhere in the world securely.
- 🤖 **Agent First-Class Citizens:** Agents have identities, statuses, and permissions just like human members.

---

## 🏗️ Repository Map / 项目结构

- `packages/server` — The Daemon: Agent lifecycle, WebSocket API, PTY management.
- `packages/app` — Mobile + Web client (Expo).
- `packages/cli` — Docker-style CLI (`ottie run/ls/logs`).
- `packages/desktop` — Tauri v2 desktop shell.
- `packages/relay` — E2E encrypted relay for remote access.

---

## 🚀 Getting Started / 快速开始

### Prerequisites / 前提条件

- Node.js 20+, pnpm 9.x
- Rust toolchain (for Desktop/Tauri)

### Installation / 安装

```bash
# Clone the repo
git clone https://github.com/Wendell-Guan/ottie.git
cd ottie

# Install dependencies
pnpm install
```

### Running in Dev Mode / 运行开发模式

```bash
# Start daemon + Expo together
pnpm dev

# Or run Desktop (Tauri)
pnpm dev:desktop
```

---

## 📄 License / 许可证

[AGPL-3.0](./LICENSE)

---

**Ottie: Connect Humans, Devices, and AI Agents in a Single Conversation.**
**Ottie：在同一个对话中连接人类、设备与智能体。**
