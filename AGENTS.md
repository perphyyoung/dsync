# AGENTS.md

[跨项目通用规则.md](../pbp/跨项目通用规则.md)，通读并理解后，输出："已通读并理解了跨项目通用规则，后续严格遵守。"

## 项目规则

- 当前项目的框架为 electron，跨项目通用规则中的 tauri/rust 部分可忽略

## 执行规则（省 token）

- 提交由用户执行：agent 只根据规范提供提交信息，不运行 `jj commit` / `jj describe`。
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

新增术语先改 `通用语言.md`，新增交互决策先改 `design.md`，改完功能同步 `dsync起步方案.md`，改了 e2e 用例同步 `e2e/e2e-readme.md`。功能改动按四件套同步；README 功能列表、AGENTS 中的数据 / 命令变化也要同步。

`todo.md` 只做临时进度追踪：实施前记录方案、疑问与勾选，完成后删除，不进入项目文档。

## 核心约定

- **判定只认内容哈希**，修改时间与大小只用于决定哈希缓存能否复用，不参与业务判定。
- **MVP 只有单向同步**，索引里的 `base` 只写不读，冲突状态未启用。
- **配对只认哈希**：两侧同哈希且各只有一个才配；同路径不同内容互相占位（`target-blocked`），本侧重复哈希标 `duplicate`。
- **索引**：每个根目录下的 `.dsync/dsync.db`，SQLite（Node 内置 `node:sqlite`，`journal_mode=DELETE` 单文件）。全量扫描用 `writeIndex`，移动迁移 / 单行重算用 `patchIndex` 只改对应行。成功 copy 用 `patchIndex` 定点写回已知哈希；refresh 只 stat / hash 失败 / 取消的目标行，不读、不写索引；索引写失败只记日志。损坏时当作空索引重建。同一个根参与多个目录对时，根不匹配先尝试左右互换，再按侧复用哈希缓存（配对仍现算），不整份丢弃/告警。
- **扫描不含方向**：`sync:scan` 只返回差异行，所有执行动作由前端 `rowDirections` / `actionForRow` 现算，单行操作与批量执行共用同一套规则。
- **不做链式腾挪**：重排路径时目标被其他文件占用就跳过该行，不排序、不搬两次，宁可让用户手工处理。
- **删除只进回收站**，回收站不可用时报错，不降级为永久删除。
- **执行永远手动**：没有自动同步、定时任务、后台监听。
- **文件级过滤命中不列行**：内部文件 / 大小 / 修改日期 / 后缀命中即跳过，不生成行、不计数；列表里的「特殊」项只含符号链接 / 特殊文件 / 读取失败，且只在显示模式「特殊」时显示。
- **显示过滤只影响可见行**：不改变扫描范围；缩小直接前端刷新，扩大时弹 ConfirmBubble（`还原修改` / `重新扫描`），同一原因组合只弹一次。
- **扫描条件改动作废与落盘时机**：设置页改条件不实时作废结果、不自动落盘；点「开始扫描」校验目录通过后才作废旧结果并写入目录对，扫描成功后才更新扫描过滤行摘要。
- **左右互换前端镜像**：已扫描时直接镜像结果（`mirrorScanResult`），不重新扫描。
- **显示模式 6 项**：全部 / 左侧 / 右侧 / 重复 / 占用 / 特殊；「忽略」只用于预览统计，不作为视图名。
- **主界面三行**：扫描过滤行（只读摘要 + 重新扫描）/ 显示过滤行（末尾「重置」）/ 显示模式行（隐藏一致项 + 显示模式）；全选在列头行中间列。
- **文件列表三列**：路径 / 修改日期 / 大小；列头点击三态循环排序（默认 → 升序 → 降序 → 默认），日期只到天（`YYYY-MM-DD`，代码用 `date` 命名）。
- **修改日期范围**：三态互斥（不限 / 最近 N 天含今天 / 自定义起止），按自然日计算。
- **过滤输入规则**：关键字只支持单个词（目录 + 文件名同时作用）；后缀多个用逗号分隔，匹配用 `endsWith`。
- **危险操作先确认**：强制重算、取消执行、删除目录对、软删除等用 ConfirmBubble 确认（选型见 `design.md`）。

## 复制与执行

- 复制统一写 `.dsynctmp` 后 rename；失败 / 校验失败删除半成品；顺序模式取消保留半成品供续传，并行模式取消删除。
- 单文件 ≥ 64MB 且源、目标都判定为 SSD 时按 8MB 分块并行（复制线程数默认 `max(2, 一半)`）；机械盘 / 未知强制顺序 1MB；并行模式取消删除半成品，顺序模式保留续传。
- 多文件复制：copy 动作并行（并行文件数默认 `max(2, 一半)`；SSD 用设置值，HDD / 未知最多 2，网络最多 4）；≥ 64MB 大文件单独走单文件分块并行；move / soft-delete 串行；进度聚合 bytesDone / bytesTotal 与 activeFiles。
- 磁盘类型自动检测（Windows PowerShell / Linux sysfs / macOS diskutil），失败按机械处理；设置可手动覆盖 自动 / 固态 / 机械 / 网络。
- 小于 4MB 用 `fs.copyFile`；大于等于 4MB 用 1MB 分块读写（常量在 `execute.ts`），块边界检查暂停 / 取消；扫描时清理超过 7 天的 `.dsynctmp`（`scan.ts`）。
- 复制后校验优先用动作携带的源侧扫描哈希（`SyncAction.sourceHash`），只读 tmp；无哈希的旧调用回退源 / 目标全量比对。不一致计入 failed 并告警。
- 单行与批量执行共用右下角执行进度小窗：延迟 300ms 出现；成功动作由 `execute` 结果直接更新行，窗口直接关闭；成功 copy 的已知哈希用 `patchIndex` 定点写回两侧索引；只有失败 / 取消 / 缺少可信哈希的目标行调用 `refresh`，只 stat / hash 这些文件，不读索引、不遍历其他文件；刷新期间隐藏关闭 / 重试并禁用重新扫描、互换、右键菜单、回收站等入口；支持暂停 / 继续、取消（确认）、最小化胶囊、限速 10 / 50 / 100 MB/s 与失败项重试；同一时刻只允许一个执行任务。
- 扫描与执行进度统一 500ms 节流；速度 / ETA 由主进程按 3 秒窗口计算，前端只格式化显示；进度条 500ms 线性补间。多文件复制时字节进度取聚合值，显示「N 个文件并行」。扫描进度页运行中始终有状态行：哈希显示 ETA，ETA 归零显示「即将完成」，配对 / 写索引显示阶段文案且保持 100%。执行复制写完字节后先补满 bytes 并标记 `verifyingFiles`，窗口显示「校验中」；节流带 trailing flush。
- 扫描哈希与复制校验走 `worker_threads` 池（electron-vite `?modulePath`）；扫描线程数存 `app_settings`，默认逻辑处理器一半、范围 1..n、恢复默认即删除记录；worker 每 100ms 批量上报字节。
- 扫描用全屏进度页，执行用进度小窗，两者不共用界面。

## 数据

- 应用数据：dev 为项目根 `ds-data/`，release 为 `userData/`；e2e 用环境变量 `DSYNC_DATA_DIR` 覆盖到临时目录。
- 目录对档案：`dsync-main.db`（应用级 SQLite，表 `dir_pairs` + `app_settings`），最多 100 组；每组存左右目录、最近扫描成功时间与该组扫描条件（JSON 列）；扫描设置页只显示最近 5 组（无滚动条），可搜索全部；左右互换视为同一组；旧 `dir-pairs.db` 不迁移、不读取、不删除。应用设置（scanThreads / copyThreads / parallelFiles / diskMode）也在同一库。
- 索引：各同步根目录下的 `.dsync/dsync.db`；整个 `.dsync/` 强制排除，永不参与比较、复制、删除。
- 日志：dev 与 e2e 写项目根 `ds.log`，release 写 `userData/ds.log`；主进程、渲染进程、e2e 共用同一份，用法见 `日志使用说明.md`。

## 代码质量

- 格式化只由 oxfmt 负责，ESLint 不启用风格规则。
- oxlint 负责 TS/JS 规则；`tsconfig` 的 `lib` 用 ES2023 以支持 `toSorted`。
- `no-await-in-loop` 对目录递归与动作串行执行是刻意设计，已在 `.oxlintrc.json` 关闭。
- renderer 不能 import 任何带 `node:` 的模块；无 Node 依赖的工具函数放 `src/lib/`（如 `exts.ts`、`format.ts`）。
- 同步核心全部落在 `src/lib/` 并使用 `node:fs`，Vitest 在 node 环境覆盖，不依赖 Electron 运行；软删除通过参数注入，单测传假实现。
- 布局百分比宽度必须核对包含块与行内间距：扫描设置页路径框 / 目录对统一 `70vw` + `shrink-0`，所有行统一 `gap-3`，标签从页面 10% 处右对齐（见 `design.md` 对齐原则）。

## e2e 约定

- 改了 `src/` 或 `electron/` 后一律用 `pnpm e2e`，不要直接 `playwright test`：后者跑的是 `out/` 里的旧构建产物，不重新 build，新代码不生效，会表现成「逻辑没改对」的假象。
- 启动必须用 `args: ["."]`；传 `out/main/main.js` 会让 `app.getAppPath()` 指向 `out/main`，preload 路径拼错导致白屏。
- 不要把 `app.firstWindow()` 的返回值命名为 `window`，会遮蔽浏览器全局 `window`，evaluate 回调里的 `window.api` 会被推断成 Playwright 的 `Page`。
- 定位器一律语义化，名称用 `exact: true`；动态文案用锚定正则。
- 布局几何断言用 `data-testid` + `boundingBox()`，不要用 evaluate 遍历文本定位元素。
- 用 `DSYNC_DATA_DIR` 隔离数据目录，不污染本机配置。
