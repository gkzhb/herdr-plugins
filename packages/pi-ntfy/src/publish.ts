import { hostname } from "node:os";
import type { Config } from "./config.ts";

export async function publish(config: Config, details: string[] = []): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  let response: Response;
  try {
    response = await fetch(config.server, {
      method: "POST",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs),
      body: JSON.stringify({
        topic: config.topic,
        title: `[${hostname()}] pi 已完成本轮工作`,
        message: details.join("\n"),
        tags: ["white_check_mark"],
        priority: 3,
        markdown: true,
      }),
    });
  } catch {
    throw new Error("ntfy request failed (network, redirect or timeout)");
  }
  // No response text is logged or retained, even for authentication failures.
  await response.body?.cancel().catch(() => {});
  if (!response.ok) throw new Error(`ntfy publish failed (HTTP ${response.status})`);
}
