# dsync 交接

跨目录层级、跨文件名的文件夹同步桌面应用。配对只认内容哈希，单向同步，删除一律软删除进内置回收站。

## 当前状态

功能已成型，可打包运行。最近一轮工作集中在底部按钮交互（预览按钮原位开关、执行同步红色、同步统计与状态统计分列）、显示模式（全部/左侧/右侧/重复/占用）、勾选框只在预览模式出现。

工作副本是 jj 的 working copy，`jj --no-pager diff --stat` 可看全部未提交改动。

## 必守规则

- **收尾只跑 `pnpm check`**：脚本已含 format（自动修）、oxlint、eslint、type-check、vitest、build。不要先手跑 `pnpm format`。
- **改了 `src/` 或 `electron/` 后必须 `pnpm e2e`**：`pnpm e2e` = `pnpm build && playwright test`。直接 `playwright test` 测的是 `out/` 旧产物，会误判成「逻辑没生效」。
- 只跑相关用例：`pnpm e2e 04-soft-delete`；纯 e2e 改动可直接 `pnpm exec playwright test <文件>`。
- 长命令后台跑、每 10–15 秒轮询、输出写日志文件；单次等待不超 15 秒。
- `jj` 一律加 `--no-pager`。
- 提交信息非必要不加正文，一行标题说清交互变化。
- 改功能必须同步文档，见下节。

## 文档地图

| 文件                | 职责                                           | 何时改      |
| ------------------- | ---------------------------------------------- | ----------- |
| `通用语言.md`       | 术语表、界面元素标准名                         | 新增/改名词 |
| `design.md`         | 交互规范、弹窗选型、布局原则、符号约定         | 改交互      |
| `dsync起步方案.md`  | 功能设计、数据流、实现状态、决策记录（D 编号） | 改功能      |
| `e2e/e2e-readme.md` | 各 e2e 文件覆盖范围                            | 改 e2e      |
| `AGENTS.md`         | 工程约定、命令、核心约定、e2e 约定             | 改流程      |
| `日志使用说明.md`   | 主进程/渲染/e2e 三处日志用法                   | 改日志      |

## 架构速览

**核心逻辑全部在 `src/lib/`，用 `node:fs`，Vitest 在 node 环境覆盖，不依赖 Electron。**

| 文件                                                    | 职责                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `pair.ts`                                               | 只按哈希配对：两侧同哈希且各只有一个才配                               |
| `plan.ts`                                               | `buildRows` 产出 7 种状态 + `actionForRow` 单行动作                    |
| `preview.ts`                                            | `buildPreview`：预览定型，按方向算动作与四项统计                       |
| `execute.ts`                                            | 执行 copy / move / soft-delete，动作串行                               |
| `recycle.ts`                                            | `softDelete` / `listDeleted` / `restoreDeleted`                        |
| `refresh.ts`                                            | `refreshPaths` 局部 stat（缓存命中复用哈希）、`detectStale` 执行前校验 |
| `verify.ts`                                             | 执行后对账，产出 mismatched                                            |
| `index-file.ts`                                         | SQLite 索引：`writeIndex` 全量、`patchIndex` 增量                      |
| `scan.ts` / `hash.ts` / `pipeline.ts` / `controller.ts` | 扫描、哈希、两遍扫描流水线、暂停取消                                   |
| `row-actions.ts`                                        | 单行两个方向的动作与删除标记                                           |

**状态**：`same` / `moved` / `duplicate` / `left-only` / `right-only` / `ignored` / `target-blocked`
**动作**：`copy` / `move` / `soft-delete`
**显示模式**：`all` / `left` / `right` / `duplicate` / `blocked`（`ViewMode`）

**前端**：`App.vue` 编排一切；`FileList` / `RowActions` / `FilterPanel` / `ProgressPage` / `RecyclePage` / `ConfirmBubble` / `ToastBubble`。

**索引**：`<root>/.dsync/dsync.db`（meta + pairs 表），软删除文件在 `<root>/.dsync/deleted/`，整个 `.dsync/` 硬排除。

**日志**：主进程、渲染进程、e2e 共用项目根 `ds.log`（e2e 用 `E2E=1` 触发）。

## 关键流程

**扫描**：`sync:scan` → countFiles（分母）→ collectFiles → 哈希（预筛 + 按字节推进）→ `pairFiles` → `planSync` → `writeIndex` → 前端 rows。进度用 `webContents.send` 推。

**预览定型**：点「向左/向右同步预览」→ `startPreview` 取当前**可见行**的索引 → `buildPreview` 全选求动作 → `selected` = 动作涉及的行 → 行内复选框出现、目标方向高亮。再点同一按钮退出（`togglePreview`）。预览期间显示模式锁定。

**执行**：`sync:execute` → `detectStale` 过滤被外部改过的 → `executeActions` → `migrateMoveCaches` → 前端 `applyRefresh`（只 stat 受影响路径）→ 两侧都空的行整行移除 → `verifyOutcome` 对账告警。

**还原**：`recycle:restore` → `applyRestored`：先按本侧同路径找行，再按「对侧同哈希且本侧为空」找配对行，都没有才新增单侧行。

**显示模式与统计**：`items` = rows 经 hideSame + viewMode 过滤；底部状态统计基于 `items`（只反映可见行）；预览统计基于 `selected`（只含勾选且可执行的行，未勾选不计入「忽略」）。

## 交互要点（易改错）

- 操作列非预览只有 `<` `>`；预览时中间多一个复选框，中间槽固定 `w-4` + `gap-2`，保证箭头不位移。
- 预览按钮 `min-w-24`，选中时文案原地变「退出预览」，宽度不变。
- 执行同步红色实心（`bg-rose-600`），因为可能含软删除；与 `ConfirmBubble` 的 danger 一致。
- 软删除走气泡确认（`ConfirmBubble`，文案写明可还原）；强制重算走红色描边 + 气泡，文案写明「不会修改任何文件」。
- 全选复选框与行内复选框只在预览模式渲染。

## 已知边界

1. 还原时对侧固定探头 `null`：若软删除后有人从外部往对侧放同名文件，会显示「仅左侧」而非「目标占用」。重扫修正。
2. `ignored` 统计不分左右：`IgnoredFile` 不带 `side`，要分需改 `scan.ts` 产出结构。
3. `result.stats` 仍在维护但不再驱动底部展示（底部改用 `recountStats(items)`），属冗余，可删。
4. 预览流程缺 e2e：进预览 → 复选框出现 → 统计与勾选数一致 → 执行后结果正确。当前 6 条 e2e 不覆盖预览。
5. 手动配对、双向同步未做，见方案文档第 16 节「后续细化」。

## 踩过的坑

- **改了 `src` 不 build 就 `playwright test`**：测旧产物，表现为「逻辑没生效」。这是最耗时的一个坑。
- **`parseExecuteRequest` 白名单**：改动作类型名（`delete` → `soft-delete`）时漏改，动作被静默丢弃，界面「点了没反应」。已改为 `Set<SyncAction["kind"]>`，新增类型会编译报错。
- **`same` 行默认被「隐藏一致项」过滤**：e2e 断言 `same` 行前要么关开关，要么改用 `moved` 场景。
- **`getByTitle` 左右两列各命中一次**：断言用 `toHaveCount(2)`，不用 `toBeVisible()`。
- **页面里 checkbox 不止一个**：过滤行的「隐藏一致项」也是 checkbox，定位表头全选要用 `getByTitle("全选 / 取消全选")`。
- **PowerShell**：`2>/dev/null` 无效（会写 `D:\dev\null`），用 `2>$null`；`&&` 后不能接变量赋值，用 `;`。
- **oxlint `no-map-spread`**：`.map` 里 spread 对象会告警，显式列字段。
- **`vue/multi-word-component-names`**：组件名必须多单词，`Popconfirm` → `ConfirmBubble`，`Toast` → `ToastBubble`。

## e2e 现状

| 文件                | 覆盖                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `01-app-shell`      | 目录表头空态、打开/更改按钮、全选复选框不渲染、显示模式五按钮、扫描/强制重算/预览入口、菜单 |
| `02-scan-and-align` | IPC 扫描得 moved、执行 move、文件落到对侧路径                                               |
| `03-recent-pairs`   | 最近目录对落盘、菜单项、重启后表头回填                                                      |
| `04-soft-delete`    | 3 个用例：重扫后消失；整行移除 + 还原恢复；配对行只清一侧 + 还原恢复配对                    |

配置：单条 test 上限 10s，断言默认 5s；显式 `timeout` 等于默认就别写，不同必须加注释说明。

`fixtures.ts` 提供 file scope 实例池（按 `testInfo.file` 切换，换文件关旧删目录）与用例标题日志；`slot` fixture 自带 15s 预算，启动不计入用例时长。

## 常用命令

```bash
pnpm check                 # 收尾唯一命令
pnpm e2e                   # build + 全部 e2e
pnpm e2e 04-soft-delete    # 只跑相关文件
pnpm dev                   # 开发
pnpm release               # 打包 NSIS
jj --no-pager diff --stat  # 看当前改动范围
```
