import { hostname } from "node:os";
import type { Config } from "./config.ts";
import type { Notification } from "./event.ts";

export async function publish(
  config: Config,
  notification: Notification,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;

  let response: Response;
  try {
    response = await fetcher(config.server, {
      method: "POST",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs),
      body: JSON.stringify({
        topic: config.topic,
        ...notification,
        title: `[${hostname()}] ${notification.title}`,
        tags: ["white_check_mark"],
        priority: 3,
        markdown: true,
      }),
    });
  } catch {
    // 不打印可能带 URL、凭据或代理详情的底层错误。
    throw new Error("ntfy 请求失败（网络错误、重定向或超时）");
  }
  // 发布不需要响应体；取消读取以避免无界响应占用内存或拖延退出。
  await response.body?.cancel().catch(() => {});
  if (!response.ok) throw new Error(`ntfy 发布失败：HTTP ${response.status}`);
}
