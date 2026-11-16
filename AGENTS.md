# AGENTS.md

[跨项目通用规则.md](../pbp/跨项目通用规则.md)，通读并理解后，输出："已通读并理解了跨项目通用规则，后续严格遵守。"

## 项目规则

- 当前项目的框架为 electron，跨项目通用规则中的 tauri/rust 部分可忽略

## 执行规则（省 token）

- 定位一律用 `rg`（ripgrep）不用 `grep`：先 `rg -n` 拿行号，再只读那一段，不 Read 全文。
- 不读全量 diff：提交信息用 `jj diff --stat` 确认文件范围，只对没把握的文件跑 `jj diff <路径>`；编辑工具返回的 diff 已经覆盖过一遍，不重复读。
- 文档改动超过整篇三成时用一次 Write 覆盖；必须用 SearchReplace 时先读目标片段（30 行内）确认格式，避免因格式化差异反复重试。
- 质量门只在收尾跑一次；中间自查用 `pnpm type-check` 或 `pnpm test <路径>`。
- 输出量大时用命令自身的开关精简（如 `vitest run --reporter=dot`、Playwright 的 `--grep`），不做事后截断。
- 命令输出必须完整读取：禁止用 `Select-Object -Last` / `rg` 过滤后下结论，失败信息常出现在中段。
- 执行命令先 `cd` 到项目目录再跑，不用 `pnpm -C <路径>`。
- `jj` 命令一律加 `--no-pager`（如 `jj --no-pager diff`），否则会进分页器卡住。
- 一条消息只做一类事：独立文件的写入可并行，读 / 改 / 验证不混在同一条消息里。
- 汇报只写结论、原因与未覆盖的风险，不复述工具已经输出的内容。
- 不在任务中途建议新开会话；上下文压缩由用户决定时机。

## 技术栈

Electron 45 · electron-vite 6 · Vue 3 + TypeScript 6 · Tailwind CSS 4 · Vitest · Playwright · oxlint · oxfmt · ESLint

## 命令

| 命令           | 用途                                          |
| -------------- | --------------------------------------------- |
| `pnpm dev`     | 开发模式启动                                  |
| `pnpm test`    | Vitest 单元测试，只跑 `src/**/*.test.ts`      |
| `pnpm e2e`     | 先 build 再跑 Playwright e2e                  |
| `pnpm check`   | 只读质量门                                    |
| `pnpm fix`     | 格式化 + lint 自动修复                        |
| `pnpm build`   | 构建三端产物到 `out/`                         |
| `pnpm release` | 打 Windows NSIS 安装包到 `release/`           |

- `pnpm check` 顺序：`format:check → lint:oxlint → lint:eslint → type-check → test → build`。
- e2e 不在 `check` 内，交付前单独跑 `pnpm e2e`。
- 清空 `node_modules` 后必须执行 `pnpm exec install-electron`：Electron 45 不再通过 postinstall 下载二进制；国内需带 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

## 文档分工

| 文件                | 职责                                                       |
| ------------------- | ---------------------------------------------------------- |
| `通用语言.md`       | 术语、界面元素标准名称、中英文对照、避免使用的旧叫法       |
| `design.md`         | 交互规范：弹窗选型、状态反馈、进度页三态、布局原则、符号约定 |
| `dsync起步方案.md`  | 功能设计与实现状态                                         |
| `日志使用说明.md`   | 主进程 / 渲染进程 / e2e 三部分日志用法，三处共用 `ds.log`  |
| `e2e/e2e-readme.md` | 各 e2e 文件的测试范围，修改 e2e 时必须同步            |

新增术语先改 `通用语言.md`，新增交互决策先改 `design.md`，改完功能同步 `dsync起步方案.md`，改了 e2e 用例同步 `e2e/e2e-readme.md`。

## 核心约定

- **判定只认内容哈希**，修改时间与大小只用于决定哈希缓存能否复用，不参与业务判定。
- **MVP 只有单向同步**，索引里的 `base` 只写不读，冲突状态未启用。
- **配对只认哈希**：两侧同哈希且各只有一个才配；同路径不同内容互相占位（`target-blocked`），本侧重复哈希标 `duplicate`。
- **索引**：每个根目录下的 `.dsync/dsync.db`，SQLite（Node 内置 `node:sqlite`，`journal_mode=DELETE` 单文件）。全量扫描用 `writeIndex`，局部刷新/迁移/单行重算用 `patchIndex` 只改对应行。损坏时当作空索引重建。
- **扫描不含方向**：`sync:scan` 只返回差异行，所有执行动作由前端 `rowDirections` / `actionForRow` 现算，单行操作与批量执行共用同一套规则。
- **不做链式腾挪**：重排路径时目标被其他文件占用就跳过该行，不排序、不搬两次，宁可让用户手工处理。
- **删除只进回收站**，回收站不可用时报错，不降级为永久删除。
- **执行永远手动**：没有自动同步、定时任务、后台监听。

## 数据

- 应用数据：dev 为项目根 `ds-data/`，release 为 `userData/`；e2e 用环境变量 `DSYNC_DATA_DIR` 覆盖到临时目录。
- 最近目录对：`recent-pairs.json`，最多 10 组、最新在前、同组去重；扫描成功后自动记录，启动时自动载入最近一组。
- 索引：各同步根目录下的 `.dsync/dsync.db`；整个 `.dsync/` 强制排除，永不参与比较、复制、删除。
- 日志：dev 与 e2e 写项目根 `ds.log`，release 写 `userData/ds.log`；主进程、渲染进程、e2e 共用同一份，用法见 `日志使用说明.md`。

## 代码质量

- 格式化只由 oxfmt 负责，ESLint 不启用风格规则。
- oxlint 负责 TS/JS 规则；`tsconfig` 的 `lib` 用 ES2023 以支持 `toSorted`。
- `no-await-in-loop` 对目录递归与动作串行执行是刻意设计，已在 `.oxlintrc.json` 关闭。
- renderer 不能 import 任何带 `node:` 的模块；无 Node 依赖的工具函数放 `src/lib/`（如 `exts.ts`、`format.ts`）。
- 同步核心全部落在 `src/lib/` 并使用 `node:fs`，Vitest 在 node 环境覆盖，不依赖 Electron 运行；软删除通过参数注入，单测传假实现。

## e2e 约定

- 改了 `src/` 或 `electron/` 后一律用 `pnpm e2e`，不要直接 `playwright test`：后者跑的是 `out/` 里的旧构建产物，不重新 build，新代码不生效，会表现成「逻辑没改对」的假象。
- 启动必须用 `args: ["."]`；传 `out/main/main.js` 会让 `app.getAppPath()` 指向 `out/main`，preload 路径拼错导致白屏。
- 不要把 `app.firstWindow()` 的返回值命名为 `window`，会遮蔽浏览器全局 `window`，evaluate 回调里的 `window.api` 会被推断成 Playwright 的 `Page`。
- 定位器一律语义化，名称用 `exact: true`；动态文案用锚定正则。
- 用 `DSYNC_DATA_DIR` 隔离数据目录，不污染本机配置。
- 超时：单条 test 上限 10s，断言与其他显式等待统一 5s；不够时先查是不是定位器写错，确实需要再加。