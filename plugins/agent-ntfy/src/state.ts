import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isRecord } from "./config.ts";
import { eventDataFromEnv } from "./event.ts";

export interface Decision {
  notify: boolean;
  status: string;
  previous: string;
}

// Every Herdr event launches a new Node process. Persist transitions, not notification content.
export async function completionDecision(env: NodeJS.ProcessEnv): Promise<Decision> {
  const data = eventDataFromEnv(env);
  const status = typeof data?.agent_status === "string" &&
    ["working", "idle", "done", "blocked", "unknown"].includes(data.agent_status)
    ? data.agent_status : "unknown";
  const fallback = { notify: status === "done", status, previous: "unknown" };
  if (!data || typeof data.pane_id !== "string" || !/^w\d+:p\d+$/.test(data.pane_id) ||
      !env.HERDR_PLUGIN_STATE_DIR) return fallback;
  const directory = path.join(env.HERDR_PLUGIN_STATE_DIR, "transitions");
  const key = createHash("sha256").update(JSON.stringify([
    env.HERDR_SOCKET_PATH ?? "", data.pane_id,
  ])).digest("hex");
  const file = path.join(directory, `${key}.json`);
  const lock = `${file}.lock`;
  let acquired = false;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // Do not steal a lock from a live writer. Crashed locks can be removed by an operator.
    const deadline = Date.now() + 2000;
    while (!acquired) {
      try { await mkdir(lock, { mode: 0o700 }); acquired = true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) throw error;
        await delay(20);
      }
    }
    let previous = "unknown";
    const agent = typeof data.agent === "string" ? data.agent : "";
    try {
      const saved: unknown = JSON.parse(await readFile(file, "utf8"));
      if (isRecord(saved) && saved.agent === agent && typeof saved.updatedAt === "number" &&
          Date.now() - saved.updatedAt >= 0 && Date.now() - saved.updatedAt < 24 * 60 * 60 * 1000 &&
          typeof saved.status === "string") previous = saved.status;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify({ status, agent, updatedAt: Date.now() }), { mode: 0o600, flag: "wx" });
      await rename(temp, file);
    } finally { await rm(temp, { force: true }); }
    // idle/done are two views of the same completion. Viewing a done tab must not notify again.
    return { status, previous, notify: status === "idle" ? previous === "working"
      : status === "done" && previous !== "done" && previous !== "idle" };
  } catch {
    throw new Error("无法记录通知状态（目录不可写、状态损坏或锁等待超时）");
  } finally {
    if (acquired) await rm(lock, { recursive: true, force: true });
  }
}
