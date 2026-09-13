import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.ts";
import { enrichedNotificationFromEnv, notificationFromEnv } from "./event.ts";
import { completionDecision } from "./state.ts";
import { publish } from "./publish.ts";

const runId = randomUUID();
const startedAt = performance.now();
let stage: "arguments" | "event" | "metadata" | "config" | "publish" = "arguments";

function log(level: "info" | "error", message: string): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    plugin: "agent-ntfy",
    runId,
    level,
    stage,
    elapsedMs: Math.round(performance.now() - startedAt),
    message,
  });
  if (level === "error") console.error(entry);
  else console.log(entry);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--test")) {
    throw new Error("用法：node src/index.ts [--test]");
  }
  const isTest = args[0] === "--test";
  stage = "event";
  const decision = isTest ? undefined : await completionDecision(process.env);
  if (decision && !decision.notify) {
    if (process.env.HERDR_PLUGIN_STATE_DIR) {
      log("info", `notification skipped: ${decision.previous} -> ${decision.status}`);
    }
    return;
  }
  let notification = isTest
    ? { title: "Herdr 通知测试", message: "Herdr → ntfy 通知链路正常" }
    : notificationFromEnv(process.env, {}, decision?.status === "idle");
  // 非完成事件无需加载通知配置或访问 ntfy。
  if (!notification) return;
  log("info", isTest ? "test notification started" : `${decision?.status} notification started`);
  if (!isTest) {
    stage = "metadata";
    notification = await enrichedNotificationFromEnv(process.env, undefined, decision?.status === "idle");
    if (!notification) return;
    log("info", "notification prepared (optional metadata is best-effort)");
  }
  stage = "config";
  const config = await loadConfig(process.env);
  log("info", "configuration loaded");
  stage = "publish";
  log("info", "ntfy publish started");
  await publish(config, notification);
  log("info", "ntfy notification sent");
}

main().catch((error: unknown) => {
  // 当前调用链的错误已在配置、事件及发布边界转换为不含原始输入的消息。
  log("error", error instanceof Error ? error.message : "未知错误");
  process.exitCode = 1;
});
