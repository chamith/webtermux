import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config";

const execFileAsync = promisify(execFile);

export interface TmuxSession {
  name: string;
  created: number; // unix seconds
  attached: boolean;
  windows: number;
}

const SESSION_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export class InvalidSessionNameError extends Error {}
export class SessionExistsError extends Error {}
export class SessionNotFoundError extends Error {}

export function assertValidName(name: string): void {
  if (!SESSION_NAME_RE.test(name)) {
    throw new InvalidSessionNameError(
      "Session names may only contain letters, numbers, '-' and '_' (max 64 chars).",
    );
  }
}

function tmuxArgs(...args: string[]): string[] {
  return ["-L", config.tmuxSocketName, ...args];
}

async function runTmux(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("tmux", tmuxArgs(...args));
    return stdout;
  } catch (err: any) {
    throw new Error(`tmux ${args.join(" ")} failed: ${err.stderr || err.message}`);
  }
}

export async function listSessions(): Promise<TmuxSession[]> {
  try {
    // tmux's format engine rewrites literal tabs to underscores in -F output,
    // so a tab can't be used as a field separator here — use "|" instead
    // (safe since session names created via this app are restricted to
    // [A-Za-z0-9_-] and can never contain one).
    const format = "#{session_name}|#{session_created}|#{session_attached}|#{session_windows}";
    const { stdout } = await execFileAsync("tmux", tmuxArgs("list-sessions", "-F", format));
    return stdout
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const [name, created, attached, windows] = line.split("|");
        return {
          name,
          created: Number(created),
          attached: attached === "1",
          windows: Number(windows),
        };
      });
  } catch (err: any) {
    // tmux exits non-zero when there's no server/sessions yet. The exact
    // message varies by version: "no server running", "no sessions", or (as
    // of tmux 3.x when the socket file doesn't exist at all) "error
    // connecting to <socket> (No such file or directory)".
    if (
      typeof err.stderr === "string" &&
      /no server running|no sessions|error connecting to .*no such file or directory/i.test(
        err.stderr,
      )
    ) {
      return [];
    }
    throw new Error(`Failed to list tmux sessions: ${err.stderr || err.message}`);
  }
}

export async function hasSession(name: string): Promise<boolean> {
  try {
    await execFileAsync("tmux", tmuxArgs("has-session", "-t", name));
    return true;
  } catch {
    return false;
  }
}

export async function createSession(name: string): Promise<void> {
  assertValidName(name);
  if (await hasSession(name)) {
    throw new SessionExistsError(`Session "${name}" already exists.`);
  }
  await runTmux(["new-session", "-d", "-s", name, "-c", process.env.HOME ?? "/"]);
}

export async function renameSession(oldName: string, newName: string): Promise<void> {
  assertValidName(newName);
  if (!(await hasSession(oldName))) {
    throw new SessionNotFoundError(`Session "${oldName}" does not exist.`);
  }
  if (await hasSession(newName)) {
    throw new SessionExistsError(`Session "${newName}" already exists.`);
  }
  await runTmux(["rename-session", "-t", oldName, newName]);
}

export async function killSession(name: string): Promise<void> {
  if (!(await hasSession(name))) {
    throw new SessionNotFoundError(`Session "${name}" does not exist.`);
  }
  await runTmux(["kill-session", "-t", name]);
}

export async function nextAutoName(): Promise<string> {
  const sessions = await listSessions();
  const existing = new Set(sessions.map((s) => s.name));
  let n = 1;
  while (existing.has(`session-${n}`)) n++;
  return `session-${n}`;
}
