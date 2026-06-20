![Vela](images/AGI128k.jpg)

# Vela

Vela 是一个 mission-first 的 AI Operating Desk。它不是把聊天框做大，而是把一次工作变成可以规划、执行、复核、回放和继续推进的任务空间：中间是 Mission Workspace，右侧 Intelligence Spine 默认折叠，顶部是命令与状态，语音、记忆、工具、权限和审查都围绕同一个 mission 运转。

当前仓库仍保留早期 Brain UI 与本地 Agent 能力，它们是 Vela 的兼容层和能力来源。新的产品主入口是 `vela.html`，重点是稳定的 Vela Shell、任务运行时、语音层、权限守卫、记忆证据和评审闭环。

## 主要能力

- Mission Workspace：把一次工作拆成目标、上下文、步骤、证据、检查和下一步。
- Intelligence Spine：右侧智能脊柱默认折叠，只在需要查看记忆、工具、风险、评审和轨迹时展开。
- Vela Voice：支持语音意图、打断、修正、状态回读和延迟观测，目标是让语音成为真正的操作入口。
- Guard Modes：通过 Plan、Assist、Act、Auto 控制权限边界，让自动化行动可解释、可暂停、可复核。
- Memory & Provenance：保留记忆召回、来源、置信度和使用痕迹，避免把“记得”变成黑箱。
- Review & Evals：围绕 golden trace、记忆召回、工具权限、语音延迟、评审声明和产品契约做持续检查。
- Legacy Brain UI：保留聊天、思考流、设置、记忆图、ACUI 卡片和本地 Agent 兼容入口。

## 项目结构

```text
vela.html                         Vela Shell 主入口
src/ui/vela/                      Focused Workbench、Mission Workspace、Intelligence Spine
src/vela/mission-runtime.js       Vela mission 状态、事件、权限和评审运行时
scripts/eval-vela-*.mjs           Vela 产品契约、回放、语音、权限和评审检查
scripts/smoke-vela-*.mjs          Vela 入口、Shell 和打包冒烟测试
docs/superpowers/status/          Vela 阶段交付、验证和交接记录
electron/                         Electron 主进程、预加载脚本和桌面窗口控制
src/index.js                      本地 Agent 主循环、调度、任务状态和启动流程
src/api.js                        本地 HTTP 服务、SSE、WebSocket、设置和管理接口
src/memory/                       记忆识别、注入、线程、焦点、召回和整理
src/capabilities/                 工具 schema、执行器、沙箱和工具市场
src/ui/brain-ui/                  兼容 Brain UI、ACUI 组件和可视化面板
sandbox/                          Agent 工作区与生成内容存放区
data/                             本地运行数据，打包时不会带入安装包
```

## 运行方式

先安装依赖：

```bash
npm install
```

启动 Vela 预览：

```bash
npm run dev:vela
```

然后打开：

```text
http://127.0.0.1:4173/vela.html
```

启动 Electron 桌面应用：

```bash
npm start
```

只启动本地后端：

```bash
npm run start:backend
```

开发时自动重启后端：

```bash
npm run dev
```

## Web 入口

本地后端默认监听：

```text
http://127.0.0.1:3721
```

常用页面：

| 页面 | 地址 | 用途 |
| --- | --- | --- |
| Vela Shell | `/vela.html` | Mission Workspace、Collapsed Spine、Voice、Review 和任务运行时 |
| Brain UI | `/brain-ui` | 兼容聊天、设置、状态、记忆图和 ACUI 可视化 |
| 激活页 | `/activation` | 首次配置 API Key |
| 运行状态 | `/status` | 查看循环、任务和记忆概览 |
| Turn Trace | `/turn-trace` | 查看回合级运行轨迹 |

如果 Electron 启动时默认端口被占用，主进程会自动寻找可用端口并加载对应地址。

## 配置

首次启动后会进入激活页，填写任意已支持 Provider 的 API Key 即可。也可以通过 `.env` 提供环境变量：

```env
LLM_PROVIDER=minimax
MINIMAX_API_KEY=your_key
```

常用配置可以在兼容设置页中完成：

- 模型 Provider、模型、温度和 API Key。
- 语音识别、TTS Provider、音色和凭证。
- 社交平台连接参数。
- 嵌入、网页搜索和安全开关。
- Agent 名称、UI 行为和媒体相关偏好。

配置会持久化到本地数据目录。敏感设置接口默认只允许本机访问；需要远程访问时应结合环境变量开启局域网访问或设置 API Token。

## 验证

Vela 主检查：

```bash
npm run check:vela
```

常用分项检查：

```bash
npm run test:vela-mission
npm run smoke:vela-shell
npm run smoke:vela-entry
npm run smoke:vela-packaged
npm run eval:vela-product-contract
npm run eval:vela-polish-readiness
```

兼容层检查：

```bash
npm run smoke:brain-ui
```

提交前建议同时跑：

```bash
git diff --check
```

## 打包

打包配置会把 Vela 入口、Vela UI、mission runtime、兼容 Brain UI、Electron 壳和必要脚本纳入安装包，同时排除本地运行数据。

```bash
npm run smoke:vela-packaged
npm run build
```

完整 Windows 安装器构建仍依赖 Electron Builder 和本地 native 模块重建环境。

## 数据与持久化

Vela 的长期状态主要保存在本地 SQLite 数据库中，包括：

- 对话记录、参与者身份和用户画像。
- 记忆节点、记忆关系、全文检索索引和可见性状态。
- 行动日志、工具结果摘要和回合轨迹。
- 提醒、任务、预取缓存和 UI 信号。
- 媒体历史、语音设置和本地配置。
- 焦点线程、承诺状态和评审证据。

`sandbox/` 用作 Agent 的工作区，适合放置生成文件、临时项目、下载内容和媒体产物。`data/` 是运行数据目录，打包时会被排除。

## License

MIT
