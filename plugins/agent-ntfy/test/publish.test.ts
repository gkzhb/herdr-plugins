import assert from "node:assert/strict";
import { hostname } from "node:os";
import { test } from "node:test";
import { publish } from "../src/publish.ts";

const config = { server: "https://ntfy.example.com/", topic: "test", token: "tk_secret", timeoutMs: 100 };
const notification = { title: "完成", message: "工作区：测试" };

test("JSON 发布带本机 hostname 前缀的中文通知、鉴权、超时信号及禁止重定向", async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, config.server);
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal instanceof AbortSignal);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer tk_secret");
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      topic: "test", ...notification, title: `[${hostname()}] 完成`, tags: ["white_check_mark"], priority: 3,
    });
    return new Response("ok");
  };
  await publish(config, notification, fetcher);
  assert.deepEqual(notification, { title: "完成", message: "工作区：测试" });
});

test("HTTP 错误不输出响应正文；网络异常不输出底层凭据", async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(publish(config, notification, async () => new Response("SECRET", { status })),
      { message: `ntfy 发布失败：HTTP ${status}` });
  }
  await assert.rejects(publish(config, notification, async () => { throw new Error("SECRET"); }),
    { message: "ntfy 请求失败（网络错误、重定向或超时）" });
});
