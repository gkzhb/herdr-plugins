import { execFile } from "node:child_process";
import { isRecord } from "./config.ts";

export interface PaneDetails {
  session?: { kind: string; value: string };
  summary?: string;
  terminalTitle?: string;
  tabId?: string;
  tabLabel?: string;
}

export type Query = (args: string[], env: NodeJS.ProcessEnv) => Promise<unknown>;

// 不经过 shell；限制每次查询时间和输出，失败仅丢失可选元数据。
export const queryHerdr: Query = (args, env) => new Promise((resolve, reject) => {
  execFile(env.HERDR_BIN_PATH || "herdr", args, {
    env, encoding: "utf8", timeout: 1500, killSignal: "SIGKILL", maxBuffer: 64 * 1024,
    windowsHide: true,
  }, (error, stdout) => {
    if (error) { reject(new Error("Herdr metadata query failed")); return; }
    try { resolve(JSON.parse(stdout)); }
    catch { reject(new Error("Invalid Herdr metadata JSON")); }
  });
});

export async function readPaneDetails(
  paneId: unknown,
  env: NodeJS.ProcessEnv,
  query: Query = queryHerdr,
): Promise<PaneDetails> {
  if (typeof paneId !== "string" || !/^w\d+:p\d+$/.test(paneId)) return {};
  const details: PaneDetails = {};
  try {
    const response = await query(["pane", "get", paneId], env);
    if (!isRecord(response) || !isRecord(response.result)) return details;
    const pane = response.result.pane;
    if (!isRecord(pane) || pane.pane_id !== paneId) return details;
    const session = pane.agent_session;
    if (isRecord(session) && session.agent === "pi" && session.source === "herdr:pi" &&
        (session.kind === "path" || session.kind === "id") && typeof session.value === "string") {
      details.session = { kind: session.kind, value: session.value };
    }
    if (typeof pane.terminal_title_stripped === "string" && pane.terminal_title_stripped.trim()) {
      details.terminalTitle = pane.terminal_title_stripped;
    }
    if (typeof pane.tab_id !== "string" || !/^w\d+:t\d+$/.test(pane.tab_id)) return details;
    details.tabId = pane.tab_id;
    const tabResponse = await query(["tab", "get", pane.tab_id], env);
    if (!isRecord(tabResponse) || !isRecord(tabResponse.result)) return details;
    const tab = tabResponse.result.tab;
    if (isRecord(tab) && tab.tab_id === pane.tab_id && typeof tab.label === "string") {
      details.tabLabel = tab.label;
    }
  } catch {
    // 窗格已关闭、CLI 不存在、服务不可用、超时或响应异常时照常通知。
  }
  return details;
}
