import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readLastAssistantText } from "../src/pi-session.ts";
import { enrichedNotificationFromEnv } from "../src/event.ts";

const entry = (role: string, content: unknown, extra = {}) => ({ type: "message", message: { role, content, ...extra } });
const text = (value: string) => [{ type: "text", text: value }];

test("Pi JSONL 读取最新 assistant 文本，经完成通知限制为 300 字", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pi-summary-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "session.jsonl");
  const save = async (entries: unknown[]) => writeFile(file, entries.map((item) => JSON.stringify(item)).join("\n") + "\n");
  await save([
    { type: "session", id: "test" }, entry("user", "prompt"), entry("assistant", text("旧消息")),
    entry("assistant", [{ type: "thinking", thinking: "PRIVATE" }, ...text("😀".repeat(301))]),
    entry("toolResult", text("TOOL_PRIVATE")), { type: "custom", data: "CUSTOM_PRIVATE" },
  ]);
  assert.equal(await readLastAssistantText(file), "😀".repeat(301));
  const env = {
    HERDR_PLUGIN_EVENT: "pane.agent_status_changed",
    HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ data: { agent: "pi", agent_status: "done", pane_id: "w1:p1" } }),
  };
  const notification = await enrichedNotificationFromEnv(env, async () => ({ result: { pane: {
    pane_id: "w1:p1", agent_session: { agent: "pi", source: "herdr:pi", kind: "path", value: file },
  } } }));
  assert.equal(notification?.message.split("最后回复：\n")[1], "😀".repeat(300));
  for (const latest of [entry("assistant", []), entry("assistant", text("  \n ")),
    entry("assistant", text("partial"), { stopReason: "aborted" }), entry("user", "next prompt")]) {
    await save([entry("assistant", text("不能复用")), latest]);
    assert.equal(await readLastAssistantText(file), undefined);
  }
  await writeFile(file, JSON.stringify(entry("assistant", text("旧的"))) + '\n{"type":"message"');
  assert.equal(await readLastAssistantText(file), undefined);
  await writeFile(file, "x".repeat(1024 * 1024 + 50) + "\n" + JSON.stringify(entry("assistant", text("尾部回复"))) + "\n");
  assert.equal(await readLastAssistantText(file), "尾部回复");
  assert.equal(await readLastAssistantText(path.join(directory, "missing.jsonl")), undefined);
  assert.equal(await readLastAssistantText("relative.jsonl"), undefined);
  const missing = await enrichedNotificationFromEnv(env, async () => ({ result: { pane: {
    pane_id: "w1:p1", agent_session: { agent: "pi", source: "herdr:pi", kind: "path", value: path.join(directory, "missing.jsonl") },
  } } }));
  assert.ok(missing);
  assert.ok(!missing.message.includes("最后回复"));
});
