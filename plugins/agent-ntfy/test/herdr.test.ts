import assert from "node:assert/strict";
import { test } from "node:test";
import { enrichedNotificationFromEnv, notificationFromEnv } from "../src/event.ts";
import { queryHerdr, readPaneDetails } from "../src/herdr.ts";
import type { Query } from "../src/herdr.ts";

const env = {
  HERDR_PLUGIN_EVENT: "pane.agent_status_changed",
  HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ data: { agent_status: "done", agent: "pi", pane_id: "w2:p2" } }),
  HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_id: "w9:p9", workspace_label: "项目", tab_id: "w2:t2", tab_label: "old" }),
};
const paneResult = { result: { pane: { pane_id: "w2:p2", tab_id: "w2:t3", terminal_title_stripped: "π - 当前会话" } } };

test("查询事件窗格及其所属 Tab，不读取会话文件/终端正文", async () => {
  const calls: string[][] = [];
  const query: Query = async (args) => {
    calls.push(args);
    return args[0] === "pane" ? paneResult : { result: { tab: { tab_id: "w2:t3", label: "通知开发" } } };
  };
  const notification = await enrichedNotificationFromEnv(env, query);
  assert.deepEqual(calls, [["pane", "get", "w2:p2"], ["tab", "get", "w2:t3"]]);
  assert.equal(notification?.message, "会话：π - 当前会话\n工作区：项目\nTab：通知开发 (w2:t3)\n窗格：w2:p2\n状态：done");
});

test("查询失败使用 context Tab；Tab 查询失败保留标题、新 Tab ID，不混用旧名称", async () => {
  const failed: Query = async () => { throw new Error("private details"); };
  const fallback = await enrichedNotificationFromEnv(env, failed);
  assert.equal(fallback?.message, "工作区：项目\nTab：old (w2:t2)\n窗格：w2:p2\n状态：done");
  const partial = await enrichedNotificationFromEnv(env, async (args) => {
    if (args[0] === "pane") return paneResult;
    throw new Error("timeout");
  });
  assert.match(partial!.message, /会话：π - 当前会话/);
  assert.match(partial!.message, /Tab：w2:t3\n/);
  assert.ok(!partial!.message.includes("old"));
});

test("忽略非 done 事件/缺少 pane ID，不调用 Herdr", async () => {
  const noQuery: Query = async () => { assert.fail("must not query"); };
  assert.equal(await enrichedNotificationFromEnv({}, noQuery), undefined);
  for (const id of [undefined, "", "--current", "w2:p2;echo secret"]) {
    assert.deepEqual(await readPaneDetails(id, {}, noQuery), {});
  }
});

test("无效或错配 pane/tab 响应不会混入其他会话数据", async () => {
  for (const response of [null, {}, { result: null }, { result: { pane: { ...paneResult.result.pane, pane_id: "w9:p9" } } }]) {
    assert.deepEqual(await readPaneDetails("w2:p2", {}, async () => response), {});
  }
  const details = await readPaneDetails("w2:p2", {}, async (args) => args[0] === "pane"
    ? paneResult : { result: { tab: { tab_id: "w9:t9", label: "wrong" } } });
  assert.equal(details.tabLabel, undefined);
  assert.equal(details.tabId, "w2:t3");
});

test("标题与 Tab 标签清理控制字符并截断", () => {
  const result = notificationFromEnv(env, { terminalTitle: "hello\n\u001b" + "x".repeat(500), tabLabel: "tab\nname" });
  assert.ok(result);
  assert.ok(result.message.length < 230);
  assert.ok(!result.message.includes("\u001b"));
  assert.match(result.message, /Tab：tab name/);
});

test("真实 CLI 启动失败被包装，可选查询安全降级", async () => {
  await assert.rejects(queryHerdr(["pane", "get", "w2:p2"], { ...process.env, HERDR_BIN_PATH: "nonexistent-herdr-test-binary" }),
    { message: "Herdr metadata query failed" });
  assert.deepEqual(await readPaneDetails("w2:p2", { ...process.env, HERDR_BIN_PATH: "nonexistent-herdr-test-binary" }), {});
});

test("CLI 包装支持 JSON、拒绝无效输出并终止超时查询", async () => {
  const childEnv = { ...process.env, HERDR_BIN_PATH: process.execPath };
  assert.deepEqual(await queryHerdr(["-e", 'console.log(JSON.stringify({result:{pane:{}}}))'], childEnv), { result: { pane: {} } });
  await assert.rejects(queryHerdr(["-e", 'console.log("invalid")'], childEnv), { message: "Invalid Herdr metadata JSON" });
  await assert.rejects(queryHerdr(["-e", 'setInterval(() => {}, 1000)'], childEnv), { message: "Herdr metadata query failed" });
});
