import assert from "node:assert/strict";
import { test } from "node:test";
import { notificationFromEnv } from "../src/event.ts";

function env(status: unknown): NodeJS.ProcessEnv {
  return {
    HERDR_PLUGIN_EVENT: "pane.agent_status_changed",
    HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ data: {
      agent_status: status, agent: "codex", workspace_id: "w1", pane_id: "w1:p1",
    } }),
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ workspace_label: "项目", focused_pane_status: "done" }),
  };
}

test("只响应完成事件，不把 context done 当作完成依据", () => {
  assert.equal(notificationFromEnv({}), undefined);
  assert.equal(notificationFromEnv({ ...env("done"), HERDR_PLUGIN_EVENT: "pane.exited" }), undefined);
  for (const status of ["working", "idle", "blocked", "error", null, undefined, {}]) {
    assert.equal(notificationFromEnv(env(status)), undefined);
  }
  assert.equal(notificationFromEnv({ ...env("working"), HERDR_PLUGIN_CONTEXT_JSON: "broken" }), undefined);
});

test("使用事件身份及工作区标签，不上传终端输出", () => {
  assert.deepEqual(notificationFromEnv(env("done")), {
    title: "codex 已完成本轮工作", message: "工作区：项目\n窗格：w1:p1\n状态：done",
  });
  assert.deepEqual(notificationFromEnv({
    HERDR_PLUGIN_EVENT: "pane.agent_status_changed",
    HERDR_PLUGIN_EVENT_JSON: '{"data":{"agent_status":"done"}}',
  }), { title: "agent 已完成本轮工作", message: "工作区：unknown\n窗格：unknown\n状态：done" });
});

test("畸形事件报错，但错误不包含输入片段", () => {
  assert.throws(() => notificationFromEnv({ ...env("done"), HERDR_PLUGIN_EVENT_JSON: "secret" }),
    { message: "HERDR_PLUGIN_EVENT_JSON 不是有效的 JSON" });
  assert.throws(() => notificationFromEnv({ ...env("done"), HERDR_PLUGIN_CONTEXT_JSON: "[]" }), /必须是 JSON 对象/);
});

test("标签清理控制字符并限制长度", () => {
  const notification = notificationFromEnv({ ...env("done"), HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
    workspace_label: "project\n\u001b" + "x".repeat(500), selected_text: "PRIVATE CONTENT",
  }) });
  assert.ok(notification);
  assert.ok(notification.message.length < 200);
  assert.ok(!notification.message.includes("\u001b"));
  assert.ok(!notification.message.includes("PRIVATE CONTENT"));
});
