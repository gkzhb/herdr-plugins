import { execFile } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function label(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const text = stripVTControlCharacters(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
  return text ? [...text].slice(0, 120).join("") : undefined;
}

async function query(args: string[]): Promise<unknown> {
  return new Promise((resolve) => {
    execFile("tuios", args, {
      encoding: "utf8", timeout: 750, killSignal: "SIGKILL", maxBuffer: 32 * 1024, windowsHide: true,
    }, (error, stdout) => {
      if (error) { resolve(undefined); return; }
      try { resolve(JSON.parse(stdout)); } catch { resolve(undefined); }
    });
  });
}

// Native tuios identity only; never query the focused window or terminal text.
export async function metadata(ctx: ExtensionContext): Promise<string[]> {
  const lines: string[] = [];
  const sessionId = ctx.sessionManager.getSessionId();
  const piSession = sessionId.match(/^[a-zA-Z0-9_.-]{1,128}$/)?.[0] === sessionId
    ? `Pi 会话：${sessionId}` : undefined;
  const pane = process.env.TUIOS_PANE_ID;
  const session = process.env.TUIOS_SESSION;
  if (session && label(session)) lines.push(`tuios 会话：${label(session)}`);
  if (pane && pane.match(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)?.[0] === pane && session) {
    const window = await query(["get-window", pane, "--session", session, "--json"]);
    if (record(window) && window.success === true && window.id === pane) {
      const title = label(window.display_name) ?? label(window.title);
      if (title) lines.unshift(`会话：${title}`);
      if (typeof window.workspace === "number" && Number.isSafeInteger(window.workspace) && window.workspace > 0) {
        const response = await query(["list-workspaces", "--session", session, "--json"]);
        const workspace = record(response) && response.success === true && Array.isArray(response.workspaces)
          ? response.workspaces.find((item: unknown) => record(item) && item.workspace === window.workspace)
          : undefined;
        const name = record(workspace) ? label(workspace.name) : undefined;
        lines.push(`tuios 工作区：${name ? `${name} (${window.workspace})` : window.workspace}`);
      }
    }
    lines.push(`tuios 窗格：${pane}`);
  }
  if (piSession) lines.push(piSession);
  return lines;
}
