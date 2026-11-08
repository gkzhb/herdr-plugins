# @gkzhb/pi-ntfy

Pi 人工 TUI 会话本轮完成后发送 ntfy 通知。独立 Pi 包，不是 Herdr manifest 插件；无需安装旧的 `plugins/agent-ntfy`。不注册 agent 工具、不改变提示词、零运行时 npm 依赖。

## 安装

要求 Node.js >= 22.18.0、支持 `agent_before_settle` / `agent_settled` 和 `ctx.mode` 的 upstream Pi（以 1.3.0 验证），无需 patch Pi。发布到 npm 后可安装：

```sh
pi install npm:@gkzhb/pi-ntfy
```

发布前或本地开发，可从本仓库根目录使用：

```sh
pi install ./packages/pi-ntfy
# 或只在这一次 Pi 进程中加载，不写入 Pi settings：
pi -e ./packages/pi-ntfy
```

安装后重启 Pi。此包不自动创建、迁移或覆盖任何配置。

## 配置与第一次通知

自行创建 `~/.pi/agent/ntfy.json`（已存在时编辑，不要覆盖）：

```json
{
  "server": "https://ntfy.example.com",
  "topic": "your-private-topic",
  "token": "YOUR_NTFY_TOKEN",
  "timeoutMs": 10000
}
```

- `server`：HTTP(S) 服务根 URL，默认 `https://ntfy.sh`；不支持路径、查询、片段或 URL 内凭据。
- `topic`：必填，1–64 个英文字母、数字、下划线或连字符。
- `token`：可选 Bearer token；非空无空白 ASCII 字符串，配置时必须使用 HTTPS。
- `timeoutMs`：1–60000 整数，默认 10000；用于 HTTP 请求的有限超时。不重试，避免重复发送。

这些字段与仓库旧 Herdr ntfy 插件对应，但配置文件相互独立。仅需复制所需字段；不要把凭据放进源码或公开 topic。Unix 下将文件权限设为 `0600`，父目录限制为当前用户可访问，Windows 下限制文件 ACL。

设置 `PI_CODING_AGENT_DIR` 时，改读该隔离 agent 目录下的 `ntfy.json`，与 Pi 自己的配置隔离方式一致。每次通知重新读取文件，修改立即生效。缺失配置时静默禁用。无效配置或投递失败仅在 TUI 显示固定、不含服务详情的 warning，连续失败不会刷屏；成功后重置 warning。

在订阅端订阅对应 topic，在人工主 TUI 中发送一个普通请求并等待结束。格式与本仓库 Herdr ntfy 插件对齐：标题为 `[主机名] pi 已完成本轮工作`，正文含会话位置、`状态：done` 及最多 300 个 Unicode 字符的“最后回复”摘要。摘要只取本轮最后一条正常停止的 assistant 文字，保留换行、清理控制字符，不读取其他会话或终端正文。中文 title 放在 UTF-8 JSON 中，避免 HTTP header 编码问题；priority 为 3，tags 为 `white_check_mark`，`markdown: true`。POST 至服务根地址；禁止自动跟随重定向，避免凭据转发。

**内容边界改变：启用通知即允许将主机名、终端标签和最后回复的前 300 字符发送到配置的 ntfy 服务。** 摘要可能包含敏感信息，请使用可信服务与私有 topic。不发送完整历史、思考过程、工具调用或工具结果，也不发送 session 文件路径。

## 通知元信息

元信息放在 ntfy 支持的 `message` 文本内，每项一行，不添加自定义 ntfy JSON 字段：

- `会话`：`tuios get-window <当前 UUID> --session <当前会话> --json` 返回的 `display_name` 或 `title`。
- `tuios 会话`：当前进程 `TUIOS_SESSION`，与 Pi 会话不同。
- `tuios 工作区`：当前窗格实际所属的数字工作区及可用名称；名称通过 `tuios list-workspaces` 获取，不使用当前聚焦的工作区。
- `tuios 窗格`：当前进程 `TUIOS_PANE_ID` 的原生 UUID，不使用 Herdr 的兼容地址或 Tab。
- `Pi 会话`：当前 `ctx.sessionManager.getSessionId()`，完整保留便于区分多个 Pi / resume；不是文件路径。

只调用原生 `tuios` CLI，不读取 `HERDR_*` 字段或调用 Herdr 兼容接口。每次查询最多 750ms、32KiB 输出，不经过 shell。CLI 不存在、查询失败、拒绝读取或返回不匹配 UUID 时省略可选信息，仍通知；无 tuios 环境时保留 Pi 会话、状态和摘要。工作区列表仅用于匹配当前窗格的工作区名称，不采集其他窗格信息。标题与标签去终端转义、控制字符并截断为 120 字符，不发送完整 CLI 响应或整个环境。

## 哪些会话会通知

1. 只允许 `ctx.mode === "tui"`，RPC / JSON / print 不通知。`hasUI` 不是主子判断依据，真正的 worker 也可能是 TUI。
2. **每次拟通知时**同步查询 `pi.events.emit("shepherdr:worker-role:v1", { sessionManager: ctx.sessionManager, reply })`。任一 `true` 响应即跳过；使用当前 session manager，不缓存角色、不依赖扩展加载顺序。
3. `false` 仅表示 Shepherdr 未将当前会话标记为 worker；无响应是 unknown，**不是已确认主 agent**。为支持独立 Pi，unknown TUI 默认允许通知。

与支持该协议的 Shepherdr（0.2.23+）一起使用时，启动标记 worker、嵌套 worker、Pulse worker，以及按原生 session ID 保留 worker 标记的 resume 都会被过滤，不需要本包维护另一套身份状态。

**边界：这不是通用 main-only 保证。** 不支持该协议的第三方启动器若用 TUI 启动子 agent，本包无法识别；独立启动后被 `assign` / `attach` 的会话不会自动变成 worker；不带 worker flag 打开 worker 的新 fork 也不自动继承旧 session ID 的标记。不要用这套默认策略声称“所有启动器下只通知唯一 root”。需要严格主会话保证时，只在受控的人工 TUI / 兼容 Shepherdr 启动路径加载本包，不要在未知第三方 TUI worker 配置中启用。

## 完成、取消与失败

仅在最终边界 `agent_settled` 发送通知。`agent_end` 只观察本次 run 的最后一条 assistant 消息，`agent_before_settle` 观察最终 `outcome`；必须同时满足 `completed`、`aborted === false`、消息 `stopReason === "stop"`、存在非空文字且不含待执行 tool call 才通知。

LLM API 错误即使带有部分文字也不通知；空白、仅思考、达到 token 上限的截断回复和仅工具调用也不算完成。`pi-retry` 可能在一次结算后另开隐藏 run，继续重试错误、空回复或截断输出；这些中间结算保持静默，直到正常停止且有有效文字才通知。重试耗尽或被取消时不发送失败通知。每个新 run 重置判定，不借用之前成功回复；不依赖重试插件的事件发射顺序，也不通过冷却时间压制后续正常通知。

这是 **Pi 的本轮完成**，不是进程退出、整个项目完成，也不保证模型答复或工具操作在业务上成功：可恢复的工具错误后正常答复仍可能是 `completed`。准备阶段失败或普通 slash 命令不一定产生完成事件。处理器被 Pi 等待，等待时间受有限请求超时及最多两次各 750ms 的可选终端查询影响；失败不让 Pi 崩溃、不发起新模型 turn。

## 可选后续：ntfy → Pi（尚未实现或启用）

ntfy 具备订阅 API，但能读取出站通知不应自动得到操作 Pi 的权限。建议未来单独设计 opt-in 入站服务，不订阅出站 topic：

- 独立、私有、最小权限的入站 topic / token，路由显式绑定 Pi session ID，生命周期结束即撤销；不要把 token 或可写入站地址附在通知中。
- 用签名、发件人授权、会话 nonce 与短有效期认证消息，不能仅信任 topic 可读性、文本声称的身份或公开的会话 ID。
- 按消息 ID + nonce 去重、持久记录已处理消息并限制时间窗口，避免重放；过滤自发消息并防止完成通知回环，限制大小与频率。
- 先在人类 UI 中审批入站内容，不自动将其作为用户批准、slash 命令或工具调用；明确区分 idle 新 prompt、busy 排队 follow-up 与 steering，缺省拒绝 busy 注入。
- 将远程文本当不可信输入；任何工具执行仍受本地权限/审批约束，ntfy 读取者不获得 shell、凭据或 approval 权限。明确断网、重连、重放及 agent 恢复时的行为后再实现。

当前包只有出站 POST，不订阅服务、不注册远程控制工具，未在正式会话上线远程输入。

## 开发检查与发布

在仓库根目录执行 `pnpm install --frozen-lockfile`、`pnpm run check`。Pi 为 type-only peer（`*`），开发期固定 1.3.0 验证；不捆绑或安装第二份运行时。仅新包启用 `skipLibCheck`，避免 Pi 1.3.0 依赖的 `.d.ts` 中 JSON 导入等声明兼容问题；本包源码仍执行仓库严格 TS 检查，不修改 upstream。`files` 白名单仅发布 `src/` 和 README（加 npm 自动包含的 package.json / LICENSE），无配置、凭据、规划或探针。维护者审查后可在包目录用 `pnpm pack` / `pnpm publish --access public` 发布；仓库根包及旧 Herdr 插件仍为 private。本次实现不执行发布。
