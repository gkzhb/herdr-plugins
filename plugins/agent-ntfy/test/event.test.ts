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

function withSummary(summary: unknown, status = "done"): NodeJS.ProcessEnv {
  const value = env(status);
  const event = JSON.parse(value.HERDR_PLUGIN_EVENT_JSON!);
  event.data.summary = summary;
  return { ...value, HERDR_PLUGIN_EVENT_JSON: JSON.stringify(event) };
}

test("仅追加非空字符串摘要，清理控制字符并保留换行", () => {
  assert.equal(notificationFromEnv(withSummary("  第一行\r\n第二行\r第三行\u0000  "))?.message,
    "工作区：项目\n窗格：w1:p1\n状态：done\n\n最后回复：\n第一行\n第二行\n第三行");
  for (const summary of [undefined, null, "", " \t\r\n ", "\u0000\u001b\u007f", 0, 123, false, {}, [], ["内容"]]) {
    assert.deepEqual(notificationFromEnv(withSummary(summary)), notificationFromEnv(env("done")));
  }
  assert.equal(notificationFromEnv(withSummary("不应发送", "working")), undefined);
});

test("摘要最多 300 个 Unicode 字符，不截断代理对", () => {
  const summary = "你😀".repeat(200);
  const message = notificationFromEnv(withSummary(summary))!.message;
  assert.equal(message.split("最后回复：\n")[1], "你😀".repeat(150));
});

test("不使用 context 或事件顶层的旧摘要", () => {
  const value = env("done");
  const event = JSON.parse(value.HERDR_PLUGIN_EVENT_JSON!);
  event.summary = "旧的顶层摘要";
  assert.deepEqual(notificationFromEnv({
    ...value,
    HERDR_PLUGIN_EVENT_JSON: JSON.stringify(event),
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ workspace_label: "项目", summary: "旧的上下文摘要" }),
  }), notificationFromEnv(value));
});
