import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { describe, expect, it } from "vitest";

import { WechatServiceError } from "./wechat-errors.js";
import { WechatService } from "./wechat-service.js";

const silentLogger = pino({ level: "silent" });

interface FakeResponse {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

interface FakeWxScenario {
  /** Map of subcommand (argv[2]) → response. Default is exit 0 with `[]`. */
  responses: Record<string, FakeResponse>;
}

/**
 * Build a fake `wx` binary by writing a Node script and a thin shell wrapper.
 * The wrapper is what we hand to `WechatService` as `wxBinaryPath`; spawning
 * it execs `node fake-wx.mjs <subcommand> ...args` with a deterministic
 * response taken from the scenario map. This is "real spawn" per the server
 * CLAUDE.md "real deps over mocks" rule — only the binary contents are
 * controlled, not the IPC layer.
 */
function buildFakeWx(scenario: FakeWxScenario): string {
  const dir = mkdtempSync(join(tmpdir(), "wx-fake-"));
  const scriptPath = join(dir, "fake-wx.mjs");
  const responsesLiteral = JSON.stringify(scenario.responses);
  writeFileSync(
    scriptPath,
    [
      `const responses = ${responsesLiteral};`,
      `const sub = process.argv[2] ?? "";`,
      `const r = responses[sub] ?? { exitCode: 0, stdout: "[]" };`,
      `if (r.stdout) process.stdout.write(r.stdout);`,
      `if (r.stderr) process.stderr.write(r.stderr);`,
      `process.exit(r.exitCode ?? 0);`,
      "",
    ].join("\n"),
  );

  if (process.platform === "win32") {
    const cmdPath = join(dir, "wx.cmd");
    writeFileSync(cmdPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`);
    return cmdPath;
  }
  const shPath = join(dir, "wx.sh");
  writeFileSync(shPath, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`);
  chmodSync(shPath, 0o755);
  return shPath;
}

function makeService(scenario: FakeWxScenario): WechatService {
  return new WechatService({
    ottieHome: mkdtempSync(join(tmpdir(), "ottie-home-")),
    logger: silentLogger,
    wxBinaryPath: buildFakeWx(scenario),
  });
}

describe("WechatService", () => {
  describe("listSessions", () => {
    it("parses sessions JSON into the typed schema", async () => {
      const service = makeService({
        responses: {
          sessions: {
            exitCode: 0,
            stdout: JSON.stringify([
              {
                chat: "张三",
                username: "wxid_abc",
                is_group: false,
                chat_type: "private",
                unread: 2,
                summary: "周五能开会吗？",
                timestamp: 1715000000,
                time: "14:32",
              },
            ]),
          },
        },
      });
      const sessions = await service.listSessions({ limit: 20 });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.chat).toBe("张三");
      expect(sessions[0]?.chat_type).toBe("private");
      expect(sessions[0]?.unread).toBe(2);
      expect(sessions[0]?.username).toBe("wxid_abc");
    });

    it("preserves unknown fields via passthrough so wx-cli adds don't drop on the floor", async () => {
      const service = makeService({
        responses: {
          sessions: {
            exitCode: 0,
            stdout: JSON.stringify([{ chat: "X", future_field: "ok" }]),
          },
        },
      });
      const sessions = await service.listSessions();
      expect((sessions[0] as Record<string, unknown>)["future_field"]).toBe("ok");
    });

    it("falls back to 'private' on unknown chat_type rather than crashing", async () => {
      const service = makeService({
        responses: {
          sessions: {
            exitCode: 0,
            stdout: JSON.stringify([{ chat: "Y", chat_type: "experimental_kind" }]),
          },
        },
      });
      const sessions = await service.listSessions();
      expect(sessions[0]?.chat_type).toBe("private");
    });

    it("treats empty stdout as an empty list", async () => {
      const service = makeService({
        responses: { sessions: { exitCode: 0, stdout: "" } },
      });
      const sessions = await service.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe("listUnread", () => {
    it("returns parsed sessions from the unread subcommand", async () => {
      const service = makeService({
        responses: {
          unread: {
            exitCode: 0,
            stdout: JSON.stringify([
              { chat: "群A", chat_type: "group", unread: 1, username: "abc@chatroom" },
            ]),
          },
        },
      });
      const list = await service.listUnread({ filter: ["private", "group"] });
      expect(list).toHaveLength(1);
      expect(list[0]?.chat_type).toBe("group");
      expect(list[0]?.username).toBe("abc@chatroom");
    });
  });

  describe("readHistory", () => {
    it("parses messages and accepts a Chinese display name", async () => {
      const service = makeService({
        responses: {
          history: {
            exitCode: 0,
            stdout: JSON.stringify([
              { sender: "", content: "周五能开会吗？", timestamp: 1715000000, type: "文本" },
              { sender: "张三", content: "大概一小时", timestamp: 1715000060, type: "文本" },
            ]),
          },
        },
      });
      const msgs = await service.readHistory({ chat: "张三", limit: 20 });
      expect(msgs).toHaveLength(2);
      expect(msgs[0]?.sender).toBe("");
      expect(msgs[0]?.content).toBe("周五能开会吗？");
      expect(msgs[1]?.sender).toBe("张三");
    });

    it("rejects empty chat selectors before spawning anything", async () => {
      const service = makeService({ responses: {} });
      await expect(service.readHistory({ chat: "  " })).rejects.toBeInstanceOf(WechatServiceError);
    });
  });

  describe("error classification", () => {
    it("classifies 'WeChat not running' stderr", async () => {
      const service = makeService({
        responses: {
          sessions: { exitCode: 1, stderr: "错误: 找不到 WeChat 进程，请确认 WeChat 正在运行" },
        },
      });
      await expect(service.listSessions()).rejects.toMatchObject({
        kind: "wechat_not_running",
      });
    });

    it("classifies 'codesign required' stderr", async () => {
      const service = makeService({
        responses: {
          sessions: {
            exitCode: 1,
            stderr:
              "task_for_pid 失败 (kr=5). 请运行: codesign --force --deep --sign - /Applications/WeChat.app",
          },
        },
      });
      await expect(service.listSessions()).rejects.toMatchObject({
        kind: "codesign_required",
      });
    });

    it("classifies daemon startup timeout stderr", async () => {
      const service = makeService({
        responses: {
          sessions: {
            exitCode: 1,
            stderr: "wx-daemon 启动超时（>15s）请查看日志: ~/.wx-cli/daemon.log",
          },
        },
      });
      await expect(service.listSessions()).rejects.toMatchObject({
        kind: "daemon_timeout",
      });
    });

    it("classifies 'not initialized' stderr", async () => {
      const service = makeService({
        responses: {
          sessions: { exitCode: 1, stderr: "读取 config.json 失败: 文件不存在" },
        },
      });
      await expect(service.listSessions()).rejects.toMatchObject({
        kind: "not_initialized",
      });
    });

    it("classifies invalid JSON output", async () => {
      const service = makeService({
        responses: { sessions: { exitCode: 0, stdout: "not json at all" } },
      });
      await expect(service.listSessions()).rejects.toMatchObject({
        kind: "invalid_json",
      });
    });

    it("falls back to 'unknown' when stderr matches no known signature", async () => {
      const service = makeService({
        responses: {
          sessions: { exitCode: 1, stderr: "some new error mode wx introduced last week" },
        },
      });
      await expect(service.listSessions()).rejects.toMatchObject({ kind: "unknown" });
    });

    it("throws binary_not_found when wx is not on PATH and no override is given", async () => {
      const service = new WechatService({
        ottieHome: mkdtempSync(join(tmpdir(), "ottie-home-")),
        logger: silentLogger,
      });
      const originalPath = process.env["PATH"];
      const originalEnv = process.env["OTTIE_WX_BINARY"];
      // Point PATH at a directory that exists but has no wx binary in it,
      // and clear OTTIE_WX_BINARY so neither resolution path succeeds.
      process.env["PATH"] = mkdtempSync(join(tmpdir(), "empty-path-"));
      delete process.env["OTTIE_WX_BINARY"];
      try {
        await expect(service.listSessions()).rejects.toMatchObject({
          kind: "binary_not_found",
        });
      } finally {
        if (originalPath === undefined) {
          delete process.env["PATH"];
        } else {
          process.env["PATH"] = originalPath;
        }
        if (originalEnv !== undefined) {
          process.env["OTTIE_WX_BINARY"] = originalEnv;
        }
      }
    });
  });

  describe("binary resolution priority", () => {
    it("honours OTTIE_WX_BINARY when no constructor override is given", async () => {
      const fakeBinary = buildFakeWx({
        responses: { sessions: { exitCode: 0, stdout: JSON.stringify([{ chat: "via-env" }]) } },
      });
      const service = new WechatService({
        ottieHome: mkdtempSync(join(tmpdir(), "ottie-home-")),
        logger: silentLogger,
      });
      const originalEnv = process.env["OTTIE_WX_BINARY"];
      process.env["OTTIE_WX_BINARY"] = fakeBinary;
      try {
        const sessions = await service.listSessions();
        expect(sessions[0]?.chat).toBe("via-env");
      } finally {
        if (originalEnv === undefined) {
          delete process.env["OTTIE_WX_BINARY"];
        } else {
          process.env["OTTIE_WX_BINARY"] = originalEnv;
        }
      }
    });

    it("constructor wxBinaryPath takes precedence over OTTIE_WX_BINARY", async () => {
      const ctorBinary = buildFakeWx({
        responses: { sessions: { exitCode: 0, stdout: JSON.stringify([{ chat: "via-ctor" }]) } },
      });
      const envBinary = buildFakeWx({
        responses: { sessions: { exitCode: 0, stdout: JSON.stringify([{ chat: "via-env" }]) } },
      });
      const service = new WechatService({
        ottieHome: mkdtempSync(join(tmpdir(), "ottie-home-")),
        logger: silentLogger,
        wxBinaryPath: ctorBinary,
      });
      const originalEnv = process.env["OTTIE_WX_BINARY"];
      process.env["OTTIE_WX_BINARY"] = envBinary;
      try {
        const sessions = await service.listSessions();
        expect(sessions[0]?.chat).toBe("via-ctor");
      } finally {
        if (originalEnv === undefined) {
          delete process.env["OTTIE_WX_BINARY"];
        } else {
          process.env["OTTIE_WX_BINARY"] = originalEnv;
        }
      }
    });
  });

  describe("daemonStatus", () => {
    it("parses 'running with PID' output", async () => {
      const service = makeService({
        responses: { daemon: { exitCode: 0, stdout: "wx-daemon 运行中 (PID 12345)" } },
      });
      const status = await service.daemonStatus();
      expect(status.running).toBe(true);
      expect(status.pid).toBe(12345);
    });

    it("parses 'not running' output", async () => {
      const service = makeService({
        responses: { daemon: { exitCode: 0, stdout: "wx-daemon 未运行" } },
      });
      const status = await service.daemonStatus();
      expect(status.running).toBe(false);
      expect(status.pid).toBeNull();
    });
  });
});
