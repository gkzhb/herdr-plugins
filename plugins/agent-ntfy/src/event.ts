import { isRecord } from "./config.ts";

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

export function notificationFromEnv(env: NodeJS.ProcessEnv): Notification | undefined {
  if (env.HERDR_PLUGIN_EVENT !== "pane.agent_status_changed") return;
  const event = jsonEnv(env, "HERDR_PLUGIN_EVENT_JSON");
  const data = isRecord(event.data) ? event.data : {};
  // 不从 context 回退状态，避免将陈旧/不相关的上下文当作完成事件。
  if (data.agent_status !== "done") return;

  const context = jsonEnv(env, "HERDR_PLUGIN_CONTEXT_JSON");
  const agent = label(data.display_agent, data.agent, context.focused_pane_agent, "agent");
  const workspace = label(context.workspace_label, data.workspace_id, context.workspace_id);
  const pane = label(data.pane_id, context.focused_pane_id);
  return {
    title: `${agent} 已完成本轮工作`,
    message: `工作区：${workspace}\n窗格：${pane}\n状态：done`,
  };
}
