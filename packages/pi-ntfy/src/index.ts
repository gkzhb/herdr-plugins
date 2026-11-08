import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { publish } from "./publish.ts";
import { metadata } from "./metadata.ts";

function isWorker(pi: ExtensionAPI, ctx: ExtensionContext): boolean {
  let worker = false;
  pi.events.emit("shepherdr:worker-role:v1", {
    sessionManager: ctx.sessionManager,
    // A positive worker response wins; no response is unknown, not proof of main.
    reply: (value: boolean) => { if (value === true) worker = true; },
  });
  return worker;
}

export default function ntfy(pi: ExtensionAPI): void {
  let outcome: "completed" | "aborted" | "error" | undefined;
  let hasFinalAnswer = false;
  let warned = false;

  pi.on("agent_start", () => { outcome = undefined; hasFinalAnswer = false; });
  // A completed boundary can also mean length, toolUse or an empty/thinking-only
  // stop. pi-retry may continue those in another run after settlement.
  pi.on("agent_end", (event) => {
    const last = event.messages.findLast((message) => message.role === "assistant");
    hasFinalAnswer = last?.role === "assistant" && last.stopReason === "stop" &&
      last.content.some((part) => part.type === "text" && part.text.trim().length > 0) &&
      !last.content.some((part) => part.type === "toolCall");
  });
  // This is observation only: never request another turn or alter the prompt.
  pi.on("agent_before_settle", (event) => { outcome = event.outcome; });
  pi.on("agent_settled", async (event, ctx) => {
    const completed = outcome === "completed" && hasFinalAnswer;
    outcome = undefined;
    hasFinalAnswer = false;
    if (event.aborted || !completed || ctx.mode !== "tui") return;
    try {
      // Query here, not at factory/session_start: worker identity can change.
      if (isWorker(pi, ctx)) return;
      const config = await loadConfig();
      if (!config) return;
      await publish(config, await metadata(ctx));
      warned = false;
    } catch {
      // Raw errors may contain endpoint, response or credentials. Never forward.
      if (!warned) {
        warned = true;
        ctx.ui.notify("pi-ntfy: notification failed; check ntfy.json and service availability.", "warning");
      }
    }
  });
}
