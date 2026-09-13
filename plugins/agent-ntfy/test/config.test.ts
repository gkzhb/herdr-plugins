import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig, parseConfig } from "../src/config.ts";

test("配置默认值和 HTTPS token", () => {
  assert.deepEqual(parseConfig({ topic: "my-topic" }), {
    server: "https://ntfy.sh/", topic: "my-topic", timeoutMs: 10_000,
  });
  assert.equal(parseConfig({ topic: "test", token: "tk_secret" }).token, "tk_secret");
  assert.equal(parseConfig({ topic: "test", server: "http://localhost:8080", timeoutMs: 50 }).timeoutMs, 50);
});

test("拒绝无效配置和不安全的凭据传输", () => {
  for (const value of [
    null, [], "oops", {}, { topic: "" }, { topic: "a/b" }, { topic: "中文" },
    { topic: "a".repeat(65) },
    ...[false, "bad", "ftp://localhost", "https://user:secret@host", "https://host/topic", "https://host/?a=b", "https://host/#a"]
      .map((server) => ({ topic: "test", server })),
    ...[0, -1, 60_001, 1.5, "1000"].map((timeoutMs) => ({ topic: "test", timeoutMs })),
    ...[null, "", "a\nb", "中文", "two words"].map((token) => ({ topic: "test", token })),
    { topic: "test", token: "secret", server: "http://localhost" },
  ]) assert.throws(() => parseConfig(value));
});

test("从配置目录读取；错误不泄露 JSON 片段", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "herdr-ntfy-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(loadConfig({}), /HERDR_PLUGIN_CONFIG_DIR/);
  const env = { HERDR_PLUGIN_CONFIG_DIR: directory };
  await assert.rejects(loadConfig(env), /无法读取/);
  await writeFile(path.join(directory, "config.json"), '{"token":"secret", broken');
  await assert.rejects(loadConfig(env), { message: "config.json 不是有效的 JSON" });
  await writeFile(path.join(directory, "config.json"), '{"topic":"test"}');
  assert.equal((await loadConfig(env)).topic, "test");
});
