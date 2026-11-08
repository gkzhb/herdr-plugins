import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  server: string;
  topic: string;
  token?: string;
  timeoutMs: number;
}

export function parseConfig(value: unknown): Config {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid ntfy configuration");
  }
  const raw = value as Record<string, unknown>;
  const server = new URL(typeof raw.server === "string" ? raw.server : "https://ntfy.sh");
  if (
    (raw.server !== undefined && typeof raw.server !== "string") ||
    !["https:", "http:"].includes(server.protocol) ||
    server.username || server.password || server.search || server.hash || server.pathname !== "/" ||
    typeof raw.topic !== "string" || raw.topic.match(/^[A-Za-z0-9_-]{1,64}$/)?.[0] !== raw.topic
  ) throw new Error("Invalid ntfy configuration");
  const config: Config = { server: server.href, topic: raw.topic, timeoutMs: 10_000 };
  if (raw.token !== undefined) {
    if (typeof raw.token !== "string" || raw.token.match(/^[\x21-\x7e]+$/)?.[0] !== raw.token || server.protocol !== "https:") {
      throw new Error("Invalid ntfy configuration");
    }
    config.token = raw.token;
  }
  if (raw.timeoutMs !== undefined) {
    if (!Number.isInteger(raw.timeoutMs) || typeof raw.timeoutMs !== "number" || raw.timeoutMs < 1 || raw.timeoutMs > 60_000) {
      throw new Error("Invalid ntfy configuration");
    }
    config.timeoutMs = raw.timeoutMs;
  }
  return config;
}

// Read on demand, so editing this file does not require an extension reload.
export async function loadConfig(): Promise<Config | undefined> {
  const directory = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  let raw: string;
  try {
    raw = await readFile(join(directory, "ntfy.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Cannot read ntfy configuration");
  }
  try {
    return parseConfig(JSON.parse(raw));
  } catch {
    // Neither parser errors nor URL errors may escape with configuration bytes.
    throw new Error("Invalid ntfy configuration");
  }
}
