# herdr-plugins

使用 **npm workspaces** 管理的 Herdr 插件 monorepo。每个 `plugins/*` 子目录都是可单独链接或通过 GitHub 安装的插件。

## 技术约定

- **Node.js >= 22.18.0**：使用 Node 原生 TypeScript 类型剥离，直接 `node src/index.ts`。
- 所有实现及自动化测试均使用 `.ts`；不使用 `tsx`、`ts-node`、打包器或编译后的 JavaScript。
- TypeScript 仅用于开发期 `tsc --noEmit` 检查，不参与运行。Node 不读取 `tsconfig.json`，也不会执行类型检查。
- 只使用可擦除的 TS 语法：禁止 enum、参数属性等需要转换的语法；`erasableSyntaxOnly` 在检查时强制此约定。
- ESM、显式 `.ts` 相对导入；类型通过 `import type` 引入。不使用路径别名。
- 插件运行期零 npm 依赖，源码不依赖 monorepo 外层文件。根目录 npm workspaces 仅管理开发工具。

选择 22.18.0 而不是 22.0.0，是因为 Node 22.18.0 默认启用类型剥离，不需要额外启动参数。Node 22 上仍可能显示 TypeScript 实验特性警告，这不代表执行失败。也可使用 Node 24 LTS。

## 插件

| 路径 | Herdr 插件 ID | 功能 |
| --- | --- | --- |
| [`plugins/agent-ntfy`](plugins/agent-ntfy/) | `herdr-plugins.agent-ntfy` | agent 进入 `done` 时发送 ntfy 通知 |

## 仓库结构

```text
.
├── .github/workflows/ci.yml  # Node 22.18 / 24，Linux / macOS / Windows
├── package.json             # 私有 workspace 根包
├── package-lock.json
├── tsconfig.base.json       # 严格检查，禁止生成 JS
└── plugins/
    └── agent-ntfy/
        ├── herdr-plugin.toml
        ├── package.json
        ├── tsconfig.json
        ├── config.example.json
        ├── src/*.ts
        └── test/*.test.ts
```

## 开发

```bash
# 可选：使用 nvm 切换至仓库指定版本
nvm install
nvm use

npm ci
npm run check
```

单独检查一个插件：

```bash
npm run typecheck --workspace @herdr-plugins/agent-ntfy
npm test --workspace @herdr-plugins/agent-ntfy
```

测试使用 Node 原生 test runner、本地临时 HTTP 服务和临时配置目录，**不会访问真实 ntfy 服务，不会读取用户的 Herdr 配置，也不会注册插件**。

## 使用 ntfy 插件

```bash
# 在本仓库根目录执行；无需 npm install 或构建
herdr plugin link "$PWD/plugins/agent-ntfy"
herdr plugin config-dir herdr-plugins.agent-ntfy
```

在返回的配置目录中创建 `config.json`，填写服务器、topic 和可选 token，然后：

```bash
herdr plugin action invoke herdr-plugins.agent-ntfy.test
herdr plugin log list --plugin herdr-plugins.agent-ntfy
```

详细配置、安全边界和排错见 [ntfy 插件说明](plugins/agent-ntfy/README.md)。上面的 shell 示例适用于 Linux/macOS；Windows 可向 `plugin link` 传入子目录的完整路径。

## 添加新插件

1. 新建 `plugins/<name>/`，包含独立的 `package.json`（`type: module`、Node 版本约束）、`herdr-plugin.toml`、`src/index.ts` 和 `test/*.test.ts`。
2. `tsconfig.json` 继承 `../../tsconfig.base.json`，提供 `typecheck` 和 `test` npm scripts。
3. manifest 中声明唯一插件 ID、平台、最低 Herdr 版本和 argv 命令，例如 `command = ["node", "src/index.ts"]`。
4. 插件目录自身应包含全部运行源码。不从其他 workspace 导入运行时代码：单独安装子目录时可能无法解析这些依赖，而且 Node 默认不对 `node_modules` 内的 TS 文件做类型剥离。
5. 配置和凭据写入 `HERDR_PLUGIN_CONFIG_DIR`，持久状态写入 `HERDR_PLUGIN_STATE_DIR`，不要写进插件源码目录。
6. 执行 `npm install` 更新锁文件、`npm run check` 验证，并在本 README 的插件表中登记。

未来确有共享逻辑需求时，再设计能够独立分发的共享方案；目前不引入没有消费者的公共包。

## 发布

将 monorepo 推送到 GitHub 后，可按子目录安装（替换下面的占位符）：

```bash
herdr plugin install OWNER/REPO/plugins/agent-ntfy
```

无需 npm 发布。`private: true` 防止误发布到 npm，不影响 Herdr 安装。可为 GitHub 仓库添加 `herdr-plugin` topic 以供 Herdr marketplace 索引。

## 参考

- [Herdr 插件文档](https://herdr.dev/docs/plugins/)
- [Node 原生 TypeScript 支持](https://nodejs.org/docs/latest-v22.x/api/typescript.html)
- [ntfy 发布 API](https://docs.ntfy.sh/publish/)
