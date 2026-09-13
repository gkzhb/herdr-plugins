import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { isRecord } from "./config.ts";

const MAX_TAIL_BYTES = 1024 * 1024;

// Deliberately follows append order, not Pi's branch tree. Never search another session.
export async function readLastAssistantText(file: string): Promise<string | undefined> {
  if (!path.isAbsolute(file) || path.extname(file) !== ".jsonl") return;
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0) return;
    const start = Math.max(0, stat.size - MAX_TAIL_BYTES);
    const buffer = Buffer.alloc(Math.min(stat.size, MAX_TAIL_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) {
      const newline = text.indexOf("\n");
      if (newline === -1) return;
      text = text.slice(newline + 1); // The first record may be partial.
    }
    const lines = text.split("\n");
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index]!.trim();
      if (!line) continue;
      const entry: unknown = JSON.parse(line);
      if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
      const message = entry.message;
      // A newer user prompt means a new round has begun; do not reuse an old reply.
      if (message.role === "user") return;
      if (message.role !== "assistant") continue;
      if (message.stopReason === "error" || message.stopReason === "aborted" || !Array.isArray(message.content)) return;
      const value = message.content.filter((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string).join("\n").trim();
      // The latest assistant may be tool-only: don't fall back to an older assistant.
      return value || undefined;
    }
  } catch {
    // Missing, malformed or concurrently incomplete session: basic notification still works.
    return;
  } finally { await handle?.close().catch(() => {}); }
}
