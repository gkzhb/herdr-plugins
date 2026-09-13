import { readFile } from "node:fs/promises";
import path from "node:path";

export interface Config {
  server: string;
  topic: string;
  token?: string;
  timeoutMs: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseConfig(value: unknown): Config {
  if (!isRecord(value)) throw new Error("config.json 必须是 JSON 对象");

  const rawServer = value.server ?? "https://ntfy.sh";
  if (typeof rawServer !== "string") throw new Error("server 必须是 URL 字符串");
  let server: URL;
  try {
    server = new URL(rawServer);
  } catch {
    throw new Error("server 必须是有效的 HTTP(S) URL");
  }
  if (
    !["https:", "http:"].includes(server.protocol) ||
    server.username || server.password || server.search || server.hash ||
    server.pathname !== "/"
  ) {
    throw new Error("server 必须是 HTTP(S) 服务根地址，不得包含凭据、路径、查询或片段");
  }

  if (typeof value.topic !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value.topic)) {
    throw new Error("topic 必须为 1–64 位英文字母、数字、下划线或连字符");
  }
  const config: Config = {
    server: server.href,
    topic: value.topic,
    timeoutMs: 10_000,
  };
  if (value.token !== undefined) {
    if (typeof value.token !== "string" || !/^[\x21-\x7e]+$/.test(value.token)) {
      throw new Error("token 必须是非空、无空白的 ASCII 字符串");
    }
    if (server.protocol !== "https:") {
      throw new Error("配置 token 时必须使用 HTTPS，避免明文发送凭据");
    }
    config.token = value.token;
  }
  if (value.timeoutMs !== undefined) {
    if (
      typeof value.timeoutMs !== "number" || !Number.isInteger(value.timeoutMs) ||
      value.timeoutMs < 1 || value.timeoutMs > 60_000
    ) {
      throw new Error("timeoutMs 必须是 1–60000 的整数");
    }
    config.timeoutMs = value.timeoutMs;
  }
  return config;
}

export async function loadConfig(env: NodeJS.ProcessEnv): Promise<Config> {
  const directory = env.HERDR_PLUGIN_CONFIG_DIR;
  if (!directory) throw new Error("缺少 HERDR_PLUGIN_CONFIG_DIR，请通过 Herdr 调用插件");
  let raw: string;
  try {
    raw = await readFile(path.join(directory, "config.json"), "utf8");
  } catch {
    throw new Error("无法读取插件配置目录中的 config.json");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // JSON.parse 的原始错误可能包含 token 等配置片段。
    throw new Error("config.json 不是有效的 JSON");
  }
  return parseConfig(value);
}
