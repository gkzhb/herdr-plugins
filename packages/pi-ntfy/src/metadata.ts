import { execFile } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function label(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
  return text ? [...text].slice(0, 120).join("") : undefined;
}

async function query(args: string[]): Promise<unknown> {
  return new Promise((resolve) => {
    execFile(process.env.HERDR_BIN_PATH || "herdr", args, {
      encoding: "utf8", timeout: 750, killSignal: "SIGKILL", maxBuffer: 32 * 1024, windowsHide: true,
    }, (error, stdout) => {
      if (error) { resolve(undefined); return; }
      try { resolve(JSON.parse(stdout)); } catch { resolve(undefined); }
    });
  });
}

// Only our environment and our pane/tab are consulted, never focused-pane/list APIs.
export async function metadata(ctx: ExtensionContext): Promise<string[]> {
  const lines: string[] = [];
  const sessionId = ctx.sessionManager.getSessionId();
  // Keep the native ID, including safe CLI-defined IDs, never a session file path.
  if (sessionId.match(/^[a-zA-Z0-9_.-]{1,128}$/)?.[0] === sessionId) lines.push(`Pi session: ${sessionId}`);
  const paneId = process.env.HERDR_PANE_ID;
  if (!paneId || paneId.match(/^w[A-Za-z0-9]+:p[A-Za-z0-9]+$/)?.[0] !== paneId) return lines;
  lines.push(`Terminal pane: ${paneId}`);
  const tuiosSession = label(process.env.TUIOS_SESSION);
  if (tuiosSession) lines.push(`tuios session: ${tuiosSession}`);
  try {
    const response = await query(["pane", "get", paneId]);
    if (!record(response) || !record(response.result)) return lines;
    const pane = response.result.pane;
    if (!record(pane) || pane.pane_id !== paneId) return lines;
    const title = label(pane.terminal_title_stripped ?? pane.terminal_title);
    if (title) lines.push(`Terminal title: ${title}`);
    const tabId = pane.tab_id;
    if (typeof tabId !== "string" || tabId.match(/^w[A-Za-z0-9]+:t[A-Za-z0-9]+$/)?.[0] !== tabId) return lines;
    // Do not fall back to inherited HERDR_TAB_ID: panes can move.
    const tabResponse = await query(["tab", "get", tabId]);
    let tabLabel: string | undefined;
    if (record(tabResponse) && record(tabResponse.result)) {
      const tab = tabResponse.result.tab;
      if (record(tab) && tab.tab_id === tabId) tabLabel = label(tab.label);
    }
    lines.push(`Terminal tab: ${tabId}${tabLabel ? ` (${tabLabel})` : ""}`);
  } catch {
    // Optional metadata must not prevent completion delivery.
  }
  return lines;
}
