// Browser-mode fixture for the AI agents page (shapes match `agent_report`).

import type { AgentItem, AgentReport, FreeUpReport } from "@/types/api";
import { demoStore } from "./demoFixtures";

const GB = 1e9;
const MB = 1e6;
const DAY = 86_400_000;
const now = Date.now();

const item = (
  tool: string,
  it: Omit<AgentItem, "id" | "removable" | "blocked" | "note"> & Partial<AgentItem>,
): AgentItem => ({
  id: `${tool}:${it.kind}:${it.path}`,
  removable: true,
  blocked: null,
  note: null,
  ...it,
});

let report: AgentReport = {
  tools: [
    {
      id: "claude-code",
      name: "Claude Code",
      open: false,
      items: [
        item("claude-code", {
          kind: "worktree",
          name: "fix-login-flow",
          detail: "In web-app · branch fix-login-flow",
          path: "~/code/web-app/.claude/worktrees/fix-login-flow",
          sizeBytes: 1.4 * GB,
          lastUsedMs: now - 21 * DAY,
          held: true,
          defaultOn: true,
        }),
        item("claude-code", {
          kind: "worktree",
          name: "new-onboarding",
          detail: "In web-app · branch new-onboarding",
          path: "~/code/web-app/.claude/worktrees/new-onboarding",
          sizeBytes: 980 * MB,
          lastUsedMs: now - 3 * DAY,
          held: true,
          defaultOn: false,
          note: "Has changes you haven't committed",
        }),
        item("claude-code", {
          kind: "oldVersion",
          name: "Claude Code 2.1.323",
          detail: "An older version that's no longer used",
          path: "~/.local/share/claude/versions/2.1.323",
          sizeBytes: 344 * MB,
          lastUsedMs: now - 5 * DAY,
          held: true,
          defaultOn: true,
        }),
        item("claude-code", {
          kind: "cache",
          name: "Claude Code logs and cache",
          detail: "Rebuilt automatically when it's needed",
          path: "~/Library/Caches/claude-cli-nodejs",
          sizeBytes: 130 * MB,
          lastUsedMs: now,
          held: false,
          defaultOn: true,
        }),
        item("claude-code", {
          kind: "history",
          name: "Old conversations in web-app",
          detail: "41 conversations untouched for 90 days",
          path: "~/.claude/projects/-code-web-app",
          sizeBytes: 612 * MB,
          lastUsedMs: now - 120 * DAY,
          held: true,
          defaultOn: false,
        }),
      ],
    },
    {
      id: "cursor",
      name: "Cursor",
      open: true,
      items: [
        item("cursor", {
          kind: "cache",
          name: "Cursor caches",
          detail: "Downloaded and compiled files the app rebuilds on its own",
          path: "~/Library/Application Support/Cursor",
          sizeBytes: 1.2 * GB,
          lastUsedMs: null,
          held: false,
          defaultOn: true,
          blocked: "Quit Cursor to clear these",
        }),
        item("cursor", {
          kind: "workspace",
          name: "State for deleted folders",
          detail: "Chat history and editor state for 23 folders that no longer exist",
          path: "~/Library/Application Support/Cursor/User/workspaceStorage",
          sizeBytes: 468 * MB,
          lastUsedMs: null,
          held: true,
          defaultOn: true,
          blocked: "Quit Cursor first",
        }),
      ],
    },
    {
      id: "vscode",
      name: "VS Code",
      open: false,
      items: [
        item("vscode", {
          kind: "cache",
          name: "VS Code caches",
          detail: "Downloaded and compiled files the app rebuilds on its own",
          path: "~/Library/Application Support/Code",
          sizeBytes: 1.8 * GB,
          lastUsedMs: null,
          held: false,
          defaultOn: true,
        }),
        item("vscode", {
          kind: "workspace",
          name: "State for deleted folders",
          detail: "Chat history and editor state for 25 folders that no longer exist",
          path: "~/Library/Application Support/Code/User/workspaceStorage",
          sizeBytes: 418 * MB,
          lastUsedMs: null,
          held: true,
          defaultOn: true,
        }),
      ],
    },
    {
      id: "ollama",
      name: "Ollama",
      open: false,
      items: [
        item("ollama", {
          kind: "model",
          name: "gpt-oss:20b",
          detail: "A downloaded model. Remove it with `ollama rm`",
          path: "~/.ollama/models",
          sizeBytes: 13.8 * GB,
          lastUsedMs: now - 40 * DAY,
          held: false,
          defaultOn: false,
          removable: false,
        }),
      ],
    },
  ],
};

export const demoAgents = {
  report: () => report,
  clean(ids: string[]): FreeUpReport {
    const chosen = report.tools.flatMap((t) => t.items).filter((i) => ids.includes(i.id));
    if (!chosen.length) throw "Those items are already gone";
    const blocked = chosen.find((i) => i.blocked);
    if (blocked) throw `${blocked.blocked}, then try again.`;
    const held = chosen.filter((i) => i.held).reduce((s, i) => s + i.sizeBytes, 0);
    const gone = chosen.filter((i) => !i.held).reduce((s, i) => s + i.sizeBytes, 0);
    if (held) demoStore.freePaths([], "AI agent cleanup", held, true);
    if (gone) demoStore.freePaths([], "AI agent cleanup", gone, false);
    report = {
      tools: report.tools
        .map((t) => ({ ...t, items: t.items.filter((i) => !ids.includes(i.id)) }))
        .filter((t) => t.items.length),
    };
    return { freedBytes: held + gone, skipped: 0 };
  },
};
