import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { TerminalProcess } from "./types.js";

const require = createRequire(import.meta.url);

interface PtyHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (event: { exitCode: number }) => void): void;
}

interface PtyModule {
  spawn(shell: string, args: string[], options: Record<string, unknown>): PtyHandle;
}

/** Ensure node-pty's helper is executable; some npm versions drop its mode bit. */
function preparePtyHelper(): void {
  if (process.platform === "win32") return;
  const packageRoot = path.resolve(path.dirname(require.resolve("node-pty")), "..");
  const candidates = [
    path.join(packageRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    path.join(packageRoot, "build", "Release", "spawn-helper"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) chmodSync(candidate, 0o755);
  }
}

export async function createTerminal(cwd: string): Promise<TerminalProcess> {
  preparePtyHelper();
  const pty = require("node-pty") as PtyModule;
  const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "/bin/sh");
  // node-pty forks a new shell attached to a new pseudo-terminal. It never
  // reuses the TTY that is running the sldz/npm process.
  const processHandle = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    cwd,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
  });

  return {
    write: (data) => processHandle.write(data),
    resize: (cols, rows) => processHandle.resize(cols, rows),
    kill: () => processHandle.kill(),
    onData: (callback) => processHandle.onData(callback),
    onExit: (callback) => processHandle.onExit(({ exitCode }) => callback(exitCode)),
  };
}
