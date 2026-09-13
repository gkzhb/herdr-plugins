import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function fixture(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "herdr-ntfy-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await writeFile(path.join(directory, "config.json"), JSON.stringify({ server: url, topic: "test" }));
  return { directory, url };
}

async function run(args: string[], extra: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("HERDR_")) delete env[key];
  env.HERDR_BIN_PATH = path.join(root, "nonexistent-herdr-test-binary");
  Object.assign(env, extra);
  const child = spawn(process.execPath, ["src/index.ts", ...args], {
    cwd: root, env, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (data: string) => { stdout += data; });
  child.stderr.setEncoding("utf8").on("data", (data: string) => { stderr += data; });
  const timer = setTimeout(() => child.kill(), 10_000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

test("原生 TS CLI 向本地 HTTP 服务发送测试及 done 通知", async (t) => {
  const received: { url: string | undefined; method: string | undefined; body: Record<string, unknown> }[] = [];
  const { directory } = await fixture(t, (req, res) => {
    let body = "";
    req.setEncoding("utf8").on("data", (chunk: string) => { body += chunk; });
    req.on("end", () => {
      received.push({ url: req.url, method: req.method, body: JSON.parse(body) });
      res.writeHead(200, { "Content-Type": "application/json" }).end('{}');
    });
  });
  const env = { HERDR_PLUGIN_CONFIG_DIR: directory };
  const result = await run(["--test"], env);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /notification sent/);
  assert.equal(result.stderr, "");
  const logs = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(logs.map((entry) => entry.stage), ["event", "config", "publish", "publish"]);
  assert.deepEqual(logs.map((entry) => entry.message), [
    "test notification started", "configuration loaded", "ntfy publish started", "ntfy notification sent",
  ]);
  for (const entry of logs) {
    assert.equal(entry.plugin, "agent-ntfy");
    assert.equal(entry.level, "info");
    assert.equal(entry.runId, logs[0].runId);
    assert.match(entry.runId, /^[0-9a-f-]{36}$/);
    assert.equal(new Date(entry.timestamp).toISOString(), entry.timestamp);
    assert.ok(Number.isInteger(entry.elapsedMs) && entry.elapsedMs >= 0);
  }
  assert.equal(received[0]?.url, "/");
  assert.equal(received[0]?.method, "POST");
  assert.equal(received[0]?.body.markdown, true);
  assert.equal(received[0]?.body.title, `[${os.hostname()}] Herdr 通知测试`);

  const done = await run([], { ...env,
    HERDR_PLUGIN_EVENT: "pane.agent_status_changed",
    HERDR_PLUGIN_EVENT_JSON: '{"data":{"agent_status":"done","agent":"codex","pane_id":"w1:p1"}}',
  });
  assert.equal(done.code, 0, done.stderr);
  const doneLogs = done.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(doneLogs.map((entry) => entry.stage), ["event", "metadata", "config", "publish", "publish"]);
  assert.equal(doneLogs[0].message, "done notification started");
  assert.notEqual(doneLogs[0].runId, logs[0].runId);
  assert.equal(received.length, 2);
  assert.equal(received[1]?.body.markdown, true);
  assert.equal(received[1]?.body.title, `[${os.hostname()}] codex 已完成本轮工作`);
});

test("忽略事件无需配置；无效参数或缺少配置返回非零", async () => {
  assert.deepEqual(await run([]), { code: 0, stdout: "", stderr: "" });
  assert.deepEqual(await run([], { HERDR_PLUGIN_EVENT: "pane.agent_status_changed", HERDR_PLUGIN_EVENT_JSON: '{"data":{"agent_status":"blocked"}}' }), { code: 0, stdout: "", stderr: "" });
  assert.equal((await run(["--test"])).code, 1);
  assert.equal((await run(["--unknown"])).code, 1);
});

test("HTTP 失败反映在 CLI 退出码中且不泄露响应", async (t) => {
  const { directory } = await fixture(t, (_req, res) => res.writeHead(401).end("SERVER_SECRET"));
  const result = await run(["--test"], { HERDR_PLUGIN_CONFIG_DIR: directory });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /HTTP 401/);
  assert.ok(!result.stderr.includes("SERVER_SECRET"));
  const failure = JSON.parse(result.stderr.trim());
  assert.equal(failure.level, "error");
  assert.equal(failure.stage, "publish");
  const logs = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(failure.runId, logs[0].runId);
  assert.ok(!result.stdout.includes("notification sent"));
});

test("重定向不会跟随", async (t) => {
  let targetHits = 0;
  const { directory } = await fixture(t, (req, res) => {
    if (req.url === "/target") targetHits++;
    res.writeHead(307, { Location: "/target" }).end();
  });
  const result = await run(["--test"], { HERDR_PLUGIN_CONFIG_DIR: directory });
  assert.equal(result.code, 1);
  assert.equal(targetHits, 0);
});

test("无响应的请求会超时退出", async (t) => {
  const { directory, url } = await fixture(t, () => {});
  await writeFile(path.join(directory, "config.json"), JSON.stringify({ server: url, topic: "test", timeoutMs: 100 }));
  const result = await run(["--test"], { HERDR_PLUGIN_CONFIG_DIR: directory });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /超时/);
});


test("配置和事件错误日志标明阶段，不泄露敏感输入", async (t) => {
  const { directory } = await fixture(t, (_req, res) => res.writeHead(200).end());
  await writeFile(path.join(directory, "config.json"), '{"token":"TOKEN_SECRET",BROKEN');
  const configResult = await run(["--test"], { HERDR_PLUGIN_CONFIG_DIR: directory });
  assert.equal(configResult.code, 1);
  assert.equal(JSON.parse(configResult.stderr.trim()).stage, "config");
  assert.ok(!configResult.stdout.includes("ntfy publish started"));
  assert.ok(!(configResult.stdout + configResult.stderr).includes("TOKEN_SECRET"));

  const eventResult = await run([], {
    HERDR_PLUGIN_EVENT: "pane.agent_status_changed",
    HERDR_PLUGIN_EVENT_JSON: '{"secret":"EVENT_SECRET",BROKEN',
  });
  assert.equal(eventResult.code, 1);
  assert.equal(JSON.parse(eventResult.stderr.trim()).stage, "event");
  assert.equal(eventResult.stdout, "");
  assert.ok(!eventResult.stderr.includes("EVENT_SECRET"));
});

test("完成事件摘要经 CLI 发往 ntfy，空摘要不生成段落且日志不含摘要", async (t) => {
  const received: Record<string, unknown>[] = [];
  const { directory } = await fixture(t, (req, res) => {
    let body = "";
    req.setEncoding("utf8").on("data", (chunk: string) => { body += chunk; });
    req.on("end", () => {
      received.push(JSON.parse(body));
      res.writeHead(200).end("{}");
    });
  });
  for (const summary of ["  SUMMARY_PRIVATE\n测试通过  ", " \n ", null]) {
    const result = await run([], {
      HERDR_PLUGIN_CONFIG_DIR: directory,
      HERDR_PLUGIN_EVENT: "pane.agent_status_changed",
      HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ data: {
        agent_status: "done", agent: "pi", pane_id: "w1:p1", summary,
      } }),
    });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(!(result.stdout + result.stderr).includes("SUMMARY_PRIVATE"));
  }
  assert.equal(received.length, 3);
  assert.equal(received[0]?.title, `[${os.hostname()}] pi 已完成本轮工作`);
  assert.equal(received[0]?.message, "工作区：unknown\n窗格：w1:p1\n状态：done\n\n最后回复：\nSUMMARY_PRIVATE\n测试通过");
  for (const body of received.slice(1)) {
    assert.equal(body.message, "工作区：unknown\n窗格：w1:p1\n状态：done");
  }
});

test("跨 Node 进程 working→idle 发送一次，done→idle 不重复", async (t) => {
  const received: Record<string, unknown>[] = [];
  const { directory } = await fixture(t, (req, res) => {
    let body = "";
    req.setEncoding("utf8").on("data", (chunk: string) => { body += chunk; });
    req.on("end", () => { received.push(JSON.parse(body)); res.writeHead(200).end("{}"); });
  });
  for (const status of ["idle", "working", "idle", "done", "idle", "working", "done", "idle"]) {
    const result = await run([], {
      HERDR_PLUGIN_CONFIG_DIR: directory, HERDR_PLUGIN_STATE_DIR: path.join(directory, "state"),
      HERDR_PLUGIN_EVENT: "pane.agent_status_changed",
      HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ data: { agent: "pi", pane_id: "w1:p1", agent_status: status } }),
    });
    assert.equal(result.code, 0, result.stderr);
  }
  assert.equal(received.length, 2);
  assert.match(String(received[0]?.message), /状态：idle/);
  assert.match(String(received[1]?.message), /状态：done/);
});
