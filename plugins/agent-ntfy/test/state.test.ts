import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { completionDecision } from "../src/state.ts";

test("跨调用识别 working→idle/done，查看完成 Tab 不重复发送", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ntfy-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = (status: string, pane = "w1:p1", agent = "pi") => ({
    HERDR_PLUGIN_STATE_DIR: directory, HERDR_SOCKET_PATH: "test-socket",
    HERDR_PLUGIN_EVENT: "pane.agent_status_changed",
    HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ data: { pane_id: pane, agent, agent_status: status } }),
  });
  for (const [status, expected] of [
    ["idle", false], ["working", false], ["idle", true], ["done", false], ["idle", false],
    ["working", false], ["done", true], ["idle", false], ["idle", false],
    ["blocked", false], ["idle", false],
  ] as const) assert.equal((await completionDecision(env(status))).notify, expected, status);
  assert.equal((await completionDecision(env("done", "w1:p2"))).notify, true);
  await completionDecision(env("working"));
  assert.equal((await completionDecision(env("idle", "w1:p1", "codex"))).notify, false);
  await completionDecision(env("working"));
  const concurrent = await Promise.all([completionDecision(env("idle")), completionDecision(env("idle"))]);
  assert.equal(concurrent.filter((result) => result.notify).length, 1);
});
