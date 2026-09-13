import { readLastAssistantText } from "./pi-session.ts";
import { isRecord } from "./config.ts";
import { readPaneDetails } from "./herdr.ts";
import type { PaneDetails, Query } from "./herdr.ts";

export interface Notification {
  title: string;
  message: string;
}

function jsonEnv(env: NodeJS.ProcessEnv, key: string): Record<string, unknown> {
  const raw = env[key];
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${key} 不是有效的 JSON`);
  }
  if (!isRecord(parsed)) throw new Error(`${key} 必须是 JSON 对象`);
  return parsed;
}

export function eventDataFromEnv(env: NodeJS.ProcessEnv): Record<string, unknown> | undefined {
  if (env.HERDR_PLUGIN_EVENT !== "pane.agent_status_changed") return;
  const event = jsonEnv(env, "HERDR_PLUGIN_EVENT_JSON");
  return isRecord(event.data) ? event.data : {};
}

function label(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      // 限制消息体大小；清理换行和终端控制字符，避免标签伪造通知字段。
      return [...value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim()]
        .slice(0, 120).join("");
    }
  }
  return "unknown";
}

export function summaryText(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const text = value.replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .trim();
  if (!text) return;
  let result = "";
  let length = 0;
  for (const char of text) {
    if (length++ === 300) break;
    result += char;
  }
  return result.trimEnd();
}

export function notificationFromEnv(env: NodeJS.ProcessEnv, details: PaneDetails = {}, allowIdle = false): Notification | undefined {
  if (env.HERDR_PLUGIN_EVENT !== "pane.agent_status_changed") return;
  const event = jsonEnv(env, "HERDR_PLUGIN_EVENT_JSON");
  const data = isRecord(event.data) ? event.data : {};
  // 不从 context 回退状态，避免将陈旧/不相关的上下文当作完成事件。
  if (data.agent_status !== "done" && !(allowIdle && data.agent_status === "idle")) return;

  const context = jsonEnv(env, "HERDR_PLUGIN_CONTEXT_JSON");
  const agent = label(data.display_agent, data.agent, context.focused_pane_agent, "agent");
  const workspace = label(context.workspace_label, data.workspace_id, context.workspace_id);
  const pane = label(data.pane_id, context.focused_pane_id);
  const tabId = details.tabId ?? context.tab_id;
  // 若窗格已移动，不把旧 context 的 Tab 名称配到新 Tab ID 上。
  const tabLabel = details.tabLabel ?? (
    !details.tabId || details.tabId === context.tab_id ? context.tab_label : undefined
  );
  const hasTabId = typeof tabId === "string" && Boolean(tabId.trim());
  const hasTabLabel = typeof tabLabel === "string" && Boolean(tabLabel.trim());
  const tab = hasTabLabel
    ? `${label(tabLabel)}${hasTabId ? ` (${label(tabId)})` : ""}`
    : hasTabId ? label(tabId) : undefined;
  // Pi 会话文本优先；其他 agent 仍可使用事件携带的摘要，不读取 context 摘要。
  const summary = summaryText(details.summary) ?? summaryText(data.summary);
  const lines = [
    ...(details.terminalTitle ? [`会话：${label(details.terminalTitle)}`] : []),
    `工作区：${workspace}`,
    ...(tab ? [`Tab：${tab}`] : []),
    `窗格：${pane}`,
    `状态：${data.agent_status}`,
    ...(summary ? ["", "最后回复：", summary] : []),
  ];
  return {
    title: `${agent} 已完成本轮工作`,
    message: lines.join("\n"),
  };
}

export async function enrichedNotificationFromEnv(
  env: NodeJS.ProcessEnv,
  query?: Query,
  allowIdle = false,
): Promise<Notification | undefined> {
  const notification = notificationFromEnv(env, {}, allowIdle);
  if (!notification) return;
  const event = jsonEnv(env, "HERDR_PLUGIN_EVENT_JSON");
  const data = isRecord(event.data) ? event.data : {};
  // 必须查询事件窗格，绝不使用当前聚焦窗格来补全标题。
  const details = await readPaneDetails(data.pane_id, env, query);
  if (data.agent === "pi" && details.session?.kind === "path") {
    const summary = await readLastAssistantText(details.session.value);
    if (summary !== undefined) details.summary = summary;
  }
  return notificationFromEnv(env, details, allowIdle);
}
