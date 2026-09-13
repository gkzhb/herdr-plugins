# Agent ntfy Notify

当 Herdr 发出 `pane.agent_status_changed` 且 `event.data.agent_status === "done"` 时，通过 ntfy JSON API 发送通知。

**`done` 是 Herdr 识别的一轮工作完成状态，不是“所有任务已成功验证”，也不是 agent 进程退出。** `working`、`idle`、`blocked` 和其他状态不会触发通知；不会从 context 中推测完成状态。

## 环境

- Herdr >= 0.8.0。
- Node.js >= 22.18.0，运行 Herdr 服务的环境中 `node` 必须在 PATH 上。
- 可达的 ntfy 服务器，以及订阅相同服务器、相同 topic 的客户端。

直接运行 `.ts`，无运行期 npm 依赖，无需构建。根仓库的 TypeScript 和 Node 类型声明仅用于开发检查。

## 安装与配置

在 monorepo 根目录执行：

```bash
herdr plugin link "$PWD/plugins/agent-ntfy"
herdr plugin config-dir herdr-plugins.agent-ntfy
```

将本插件目录内的 `config.example.json` 复制到上一步输出的配置目录，命名为 `config.json`，并修改 topic。Herdr 不会自动加载插件根目录的配置，也不会自动替换示例值。

公共服务器示例：

```json
{
  "server": "https://ntfy.sh",
  "topic": "replace-with-a-long-random-topic",
  "timeoutMs": 10000
}
```

带访问控制的服务器示例：

```json
{
  "server": "https://ntfy.example.com",
  "topic": "herdr-agent-events",
  "token": "tk_REPLACE_WITH_YOUR_TOKEN",
  "timeoutMs": 10000
}
```

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `server` | 否 | 默认 `https://ntfy.sh`，必须是服务根 URL，允许端口；不接受子路径、topic、查询参数、片段或 URL 内嵌凭据 |
| `topic` | 是 | 1–64 位 ASCII 字母、数字、下划线或连字符；必须符合服务器自身的 topic 规则 |
| `token` | 否 | Bearer Token，须有该 topic 的发布权限；配置 token 后强制 HTTPS |
| `timeoutMs` | 否 | 默认 10000，取值 1–60000 的整数 |

Linux/macOS 可执行 `chmod 600 /实际配置目录/config.json` 保护凭据；Windows 请设置相应文件 ACL。不要把真实配置或 token 提交到仓库。

配置每次发送时重新读取，无需重启。若更改了 manifest，请重新 `herdr plugin link`；只修改脚本通常无需重新链接。

## 验证

先在手机或桌面 ntfy 客户端中订阅所配置的 topic，再执行：

```bash
herdr plugin action invoke herdr-plugins.agent-ntfy.test
herdr plugin log list --plugin herdr-plugins.agent-ntfy
```

测试 action 不依赖 agent 事件，直接发送一条“Herdr 通知测试”。调用 action 成功只表示命令已启动；最终投递状态应查看插件日志和客户端。

之后在 Herdr 中运行一个已集成的 agent，等待状态切换为 `done`。通知内容类似：

```text
codex 已完成本轮工作

会话：π - 实现通知插件 - my-project
工作区：my-project
Tab：开发 (w1:t1)
窗格：w1:p1
状态：done
```

如果测试正常但真实事件不触发，检查 `herdr plugin list` 中插件是否启用、Herdr 是否识别 agent、状态是否真的变成了 `done`。本插件无法补偿缺失的 agent 集成或状态事件。

如报 `node` 找不到或 TS 语法错误，检查 **Herdr 服务进程** 使用的 PATH 和 Node 版本，而不仅是当前交互 shell；Herdr manifest 不会执行 nvm 初始化。

卸载本地链接：

```bash
herdr plugin unlink herdr-plugins.agent-ntfy
```

## 实现与边界

- `src/index.ts`：Herdr 事件入口与 `--test` action。
- `src/event.ts`：完成事件过滤与消息生成。
- `src/herdr.ts`：通过 `HERDR_BIN_PATH` 查询事件窗格的终端标题与所属 Tab。
- `src/config.ts`：读取并验证独立配置。
- `src/publish.ts`：POST 到 ntfy 根 URL，topic、中文标题及消息位于 JSON 正文中。
- 非完成事件静默退出，不加载配置、不访问网络。
- 失败返回非零退出码；错误日志不打印 token、配置原文或服务器响应正文。
- 不跟随 HTTP 重定向，避免把凭据转发到其他地址。
- 使用 `pane get <事件 pane_id>` 的 `terminal_title_stripped` 作为会话显示标题，保留其完整格式（最长 120 个 Unicode 码点），不猜测或去掉 Pi 的前后缀。
- 根据返回的 `tab_id` 调用 `tab get` 获取 Tab 名称，同时显示 Tab ID 和窗格 ID。不会查询当前聚焦窗格。
- 每次 Herdr 查询超时 1.5 秒，最多顺序执行两次；输出上限 64 KiB。失败时保留已获取的信息，回退到事件 context 的 Tab 信息，不影响基本通知。窗格已移动时不会把旧 Tab 名称配到新 ID 上。
- 标题和 Tab 是查询时的实时元数据，而非完成事件的历史快照；极快的窗格移动或会话切换可能导致显示查询时的新信息。
- 不读取 Pi session 文件、对话或终端正文。但终端标题、Tab/工作区名称和相关 ID 会发往 ntfy；终端标题本身可能包含路径或其他敏感信息。
- 公共、未受访问控制的 topic 不等于私密通道；随机 topic 不能替代访问控制。敏感用途应使用 HTTPS、受保护的 topic 和最小权限 token。
- 无自动重试、持久队列、限流或去重；离线期间可能丢失通知，多次 `done` 转换可能产生多条通知。不保证 exactly-once 或手机实际送达。
- HTTP 2xx 仅代表服务接受请求。客户端订阅、移动系统推送设置及自建 ntfy 的 iOS 即时推送配置需要另行确认。
- 不支持通过 URL 子路径反向代理的 ntfy 部署；使用独立域名或端口。

## 开发验证

从 monorepo 根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm run check
```

测试覆盖配置校验、事件过滤、JSON 请求、鉴权、中文内容、网络异常、HTTP 错误、重定向、超时，以及真实 Node 子进程直接执行 `.ts` 的端到端本地 HTTP 测试。不向真实 ntfy topic 发送任何通知。
