# Agent ntfy Notify

当 Herdr 发出 `pane.agent_status_changed` 时，识别完成转换并通过 ntfy JSON API 发送通知：

- `working → idle`：正在查看的 Tab 中完成工作，也发送通知。
- 进入 `done`：保留后台完成通知；已记录为 `idle`/`done` 时不重复发送。
- 初始 `idle`、`done → idle`（查看已完成 Tab）和重复空闲事件不发送。

Herdr 的 `idle`/`done` 都表示可以继续输入，区别在于 Tab 是否已被查看；**不代表所有任务通过验证，也不代表 agent 进程退出。**

插件在 `HERDR_PLUGIN_STATE_DIR/transitions` 按 Herdr socket 和窗格保存上次状态（不存回复内容），跨进程加锁避免重复空闲事件同时发送。状态超过 24 小时或 agent 类型改变则失效。没有状态目录时只保留原 `done` 通知，无法判断 `working → idle`；启用后的第一轮若未记录到 `working`，也不能识别该转换。

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

测试 action 不依赖 agent 事件，直接发送一条“[hostname] Herdr 通知测试”。调用 action 成功只表示命令已启动；最终投递状态应查看插件日志和客户端。

之后在 Herdr 中运行一个已集成的 agent，等待状态切换为 `done`。通知内容类似：

```text
[my-host] codex 已完成本轮工作

会话：π - 实现通知插件 - my-project
工作区：my-project
Tab：开发 (w1:t1)
窗格：w1:p1
状态：done
```

所有通知（包括测试通知）的标题最前方都会添加 `[hostname] `，通过 Node.js `os.hostname()` 获取运行插件的当前机器主机名，无需配置；上例主机名为 `my-host`。

如果测试正常但真实事件不触发，检查 `herdr plugin list` 中插件是否启用、Herdr 是否识别 agent、状态是否真的变成了 `done`。本插件无法补偿缺失的 agent 集成或状态事件。

如报 `node` 找不到或 TS 语法错误，检查 **Herdr 服务进程** 使用的 PATH 和 Node 版本，而不仅是当前交互 shell；Herdr manifest 不会执行 nvm 初始化。

卸载本地链接：

```bash
herdr plugin unlink herdr-plugins.agent-ntfy
```

## Pi 最新回复摘要

对 Pi 完成通知，查询**事件窗格**的 `agent_session`，当它提供 Pi 会话的绝对 `.jsonl` 路径时，读取文件尾部（最多 1 MiB），按文件追加顺序查找最后一条 assistant 消息，只取 `text` 内容，排除 thinking、工具调用和工具结果。

文本经非空判断、控制字符清理后，最多保留 300 个 Unicode 码点，保留换行，在正文末尾追加“最后回复”。如果最新 assistant 无文本、出错或中止，不回退到更早的 assistant；如果尾部已有新 user 消息，也不使用上一轮回复。文件缺失、不可读或尾部 JSON 不完整时，跳过文件摘要，仍发送基本通知。

Pi 会话摘要优先；未取得非空会话摘要时，仍兼容事件的非空字符串 `data.summary`。不会从 context 读取摘要。

**不需要定制 Pi 扩展，也不依赖 Herdr 透传 summary。** 使用 Herdr 默认 Pi 集成提供的会话路径即可，不新增本机摘要缓存通道。

此方案读取的是查询时文件中最后追加的 assistant 消息，不解析当前分支树，也不保证与完成事件严格绑定。会话切换、分支切换、并发新回复或延迟事件可能导致摘要与原完成轮次不完全一致；超过读取上限的记录可能被忽略。

## 运行日志

通过 Herdr 查看插件的标准输出和错误输出：

```bash
herdr plugin log list --plugin herdr-plugins.agent-ntfy
```

插件输出单行 JSON 日志，普通日志写入 stdout，失败日志写入 stderr，并返回非零退出码。每条日志包含：

- `timestamp`：UTC 时间。
- `plugin`：固定为 `agent-ntfy`。
- `runId`：本次进程运行的唯一 ID，用于关联同一次调用的日志。
- `level`：`info` 或 `error`。
- `stage`：`arguments`、`event`、`metadata`、`config` 或 `publish`，标明当前处理阶段。
- `elapsedMs`：从进程内日志计时开始累计的耗时（毫秒），不是单个阶段耗时。
- `message`：处理结果或已脱敏的错误说明。

测试通知依次记录 `test notification started`、`configuration loaded`、`ntfy publish started`、`ntfy notification sent`。真实完成通知以 `done notification started` 或 `idle notification started` 开始，并额外记录消息准备完成；可选的 Herdr 元数据查询失败仍会降级发送，准备完成日志不代表元数据查询成功。

例如，发送被服务器拒绝时，错误日志的 `stage` 为 `publish`，`message` 为 `ntfy 发布失败：HTTP 401`。成功日志仅表示 ntfy HTTP 请求成功，不保证客户端已收到推送。

有状态目录时，被跳过的事件记录 `notification skipped: 上次状态 -> 当前状态`，便于排查；没有状态目录时仍静默跳过。日志不包含 token、topic、服务器 URL、通知标题/正文、原始事件或服务器响应正文；不另外创建日志文件。

## 实现与边界

- `src/index.ts`：Herdr 事件入口与 `--test` action。
- `src/event.ts`：完成事件过滤与消息生成。
- `src/herdr.ts`：通过 `HERDR_BIN_PATH` 查询事件窗格的终端标题与所属 Tab。
- `src/config.ts`：读取并验证独立配置。
- `src/publish.ts`：POST 到 ntfy 根 URL，topic、中文标题及消息位于 JSON 正文中。所有通知（包括测试通知）均设置 `markdown: true`，请求客户端按 Markdown 渲染正文；实际呈现取决于 ntfy 客户端支持。
- 非完成事件只更新状态记录，不加载通知配置、不访问 ntfy。
- 失败返回非零退出码；错误日志不打印 token、配置原文或服务器响应正文。
- 不跟随 HTTP 重定向，避免把凭据转发到其他地址。
- 使用 `pane get <事件 pane_id>` 的 `terminal_title_stripped` 作为会话显示标题，保留其完整格式（最长 120 个 Unicode 码点），不猜测或去掉 Pi 的前后缀。
- 根据返回的 `tab_id` 调用 `tab get` 获取 Tab 名称，同时显示 Tab ID 和窗格 ID。不会查询当前聚焦窗格。
- 每次 Herdr 查询超时 1.5 秒，最多顺序执行两次；输出上限 64 KiB。失败时保留已获取的信息，回退到事件 context 的 Tab 信息，不影响基本通知。窗格已移动时不会把旧 Tab 名称配到新 ID 上。
- 标题和 Tab 是查询时的实时元数据，而非完成事件的历史快照；极快的窗格移动或会话切换可能导致显示查询时的新信息。
- 会读取事件窗格对应的 Pi session JSONL 尾部，不读取终端正文。最多 300 字的回复文本、机器主机名、终端标题、Tab/工作区名称和相关 ID 会发往 ntfy；摘要和终端标题可能包含代码、路径或凭据，插件不做内容级自动脱敏，日志不记录摘要。
- 公共、未受访问控制的 topic 不等于私密通道；随机 topic 不能替代访问控制。敏感用途应使用 HTTPS、受保护的 topic 和最小权限 token。
- 无自动重试、持久发送队列或限流；仅按已记录的状态转换避免 idle/done 重复通知。状态先于发送落盘，发送失败不会自动补发；事件缺失、乱序、状态过期或进程被中止可能导致漏发或误判，不保证 exactly-once 或手机实际送达。异常退出留下的 `.lock` 目录需确认无进程使用后手动移除。
- HTTP 2xx 仅代表服务接受请求。客户端订阅、移动系统推送设置及自建 ntfy 的 iOS 即时推送配置需要另行确认。
- 不支持通过 URL 子路径反向代理的 ntfy 部署；使用独立域名或端口。

## 开发验证

从 monorepo 根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm run check
```

测试覆盖配置校验、事件过滤、JSON 请求、鉴权、中文内容、网络异常、HTTP 错误、重定向、超时，以及真实 Node 子进程直接执行 `.ts` 的端到端本地 HTTP 测试。不向真实 ntfy topic 发送任何通知。
