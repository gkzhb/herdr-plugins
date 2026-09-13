import { loadConfig } from "./config.ts";
import { notificationFromEnv } from "./event.ts";
import { publish } from "./publish.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--test")) {
    throw new Error("用法：node src/index.ts [--test]");
  }
  const notification = args[0] === "--test"
    ? { title: "Herdr 通知测试", message: "Herdr → ntfy 通知链路正常" }
    : notificationFromEnv(process.env);
  // 非完成事件无需加载配置、执行网络请求或输出日志。
  if (!notification) return;
  const config = await loadConfig(process.env);
  await publish(config, notification);
  console.log("ntfy notification sent");
}

main().catch((error: unknown) => {
  console.error(`[agent-ntfy] ${error instanceof Error ? error.message : "未知错误"}`);
  process.exitCode = 1;
});
