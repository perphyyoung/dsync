# todo

本文件仅供临时性的进度追踪，其它文件不得引用。

## P1 进度更新节奏与后台 ETA（已确定，待执行）

### 方案

1. **后台计算速度 / ETA**
   - `ExecuteProgress` 增加 `bytesPerSecond`、`etaSeconds`。
   - `execute.ts` 复用 `RateTracker`（3 秒滑窗）：复制动作开始时 reset 并以续传偏移为起点，每个 1MB 块 record；进度对象带 rate / eta。改名 / 软删除为 0 / null。
   - 扫描侧已是后台计算，不动。
   - 前端删除 `samples` / `speed` / `etaText`，只格式化显示后端字段。
   - `ExecutionController` 增加 `resumeCount`（仅从暂停恢复时 +1），恢复后 reset 窗口；改限速时也 reset。

2. **推送节奏 500ms**
   - `pipeline.ts` `createEmitter`：100ms → 500ms，阶段切换仍 force。
   - `main.ts` 执行进度：100ms → 500ms，删除 ≥1MB 字节跳变绕过。
   - 首帧立即推；终态由 `execute` 返回值落。

3. **界面平滑**
   - 两条进度条 `transition-[width] duration-500 ease-linear`。
   - 总进度改为包含当前文件：`(done + fileBytesDone / fileBytesTotal) / total`。
   - 速度取整（≥10 MB/s 整数，<10 保留 1 位）；ETA 用 `formatEta` 分档。

### 实施阶段

- [ ] `types.ts`：`ExecuteProgress` 增加两个字段
- [ ] `execute.ts`：每块 record，进度带 rate / eta
- [ ] `execute-controller.ts`：`resumeCount`，限速变化重置
- [ ] `pipeline.ts`、`main.ts`：节流 500ms，删除字节绕过
- [ ] `ExecuteProgressWindow.vue`：删本地采样，显示后端字段，百分比含文件占比，条 500ms 补间
- [ ] `ProgressPage.vue`：进度条补间 500ms
- [ ] `App.vue`：`resetExecWindow` 默认字段补齐
- [ ] 单测（进度字段、`resumeCount`）/ e2e 09 复跑
- [ ] 文档：design、起步方案 D49、通用语言、AGENTS.md、e2e-readme

## P2 哈希 worker 与扫描线程数（已定，待执行）

### 已定

- 哈希（扫描 + 复制校验）移出主进程主线程，使用 `worker_threads` 池。
- Worker 构建入口按 electron-vite 官方推荐：`?modulePath`（worker 文件路径 + `new Worker(path)`），备选 `?nodeWorker`。
- 线程数读取 `os.availableParallelism()`，默认一半，**不封顶**；允许范围 1..n；64 核即 32。
- 界面名称统一「扫描线程数」，不暴露“哈希”实现细节；tooltip 说明目录遍历仍为单线程。
- 扫描设置页增加「扫描线程数」，应用级设置；主界面状态栏最右加 gear，打开应用级设置弹窗（复制相关设置也放这里）。
- 存储统一到数据库：新文件 `dsync-main.db`，避免与扫描根目录下的 `.dsync/dsync.db` 混淆；新增 `app_settings` 表（key/value）。
- **不迁移旧 `dir-pairs.db`**：旧文件原样保留、不再读取，新库从空开始；目录对档案丢一次可接受，不写迁移逻辑、不删除旧文件。
- 复制校验复用同一池；P2 不暴露复制线程数。

### 设置语义

- `app_settings` 无 `scanThreads` 记录 = 自动（当前机器一半）；用户修改后写入显式值；读取时 clamp 到 1..n。
- 提供「恢复默认」：删除记录，回到自动。
- 生效时机：下次扫描；扫描进行中禁用修改。

### 实施阶段

- [ ] `main.ts` 数据文件路径改为 `dsync-main.db`
- [ ] `dir-pairs-db.ts` → `main-db.ts`（或保留模块名并新增 `openMainDb`），新增 `app_settings` 表与 get/set/delete
- [ ] `electron/hash-worker.ts`：worker 内复用 `src/lib/hash.ts`，100ms 批量上报字节
- [ ] `src/lib/hash-pool.ts`：任务队列、并发、暂停/取消、worker 崩溃重建；worker 工厂可注入（Vitest 用假实现）
- [ ] 扫描接入：`pipeline.ts` 的 `mapLimit` 改为向池提交；`HASH_CONCURRENCY` 由设置决定
- [ ] 执行校验接入：同一池，串行任务
- [ ] 设置 IPC：读取（含默认值/clamp）、写入、恢复默认
- [ ] 扫描设置页「扫描线程数」+ 状态栏 gear 设置弹窗
- [ ] 单测 / e2e（设置持久化）/ 文档（design、起步方案、通用语言、AGENTS、README、e2e-readme）

### 实现约束

- Worker 文件不能被 Vitest 直接打包：池接受工厂注入，单测不依赖 `?modulePath`。
- 进度：worker 每 100ms 批量 postMessage，主进程聚合；不按 1MB 块发消息。
- 暂停：扫描暂停中断当前文件，恢复后该文件从头读；worker 关闭当前流。
- 取消：停止队列，终止在跑任务；已完成结果保留。
- Worker 崩溃：按读取失败计，重建 worker，记日志，不拖垮整次扫描。
- 池按需创建、空闲回收：不是启动就创建 n 个；高核机器（如 32 线程）只在扫描期间占用，文档注明内存代价。

## P3 单文件并行复制（方案待确认）

### 背景与取舍

- 竞品中文件级并行更常见（robocopy `/MT`、rclone `--transfers`、FreeFileSync、FastCopy），单文件多流主要是 rclone（`--multi-thread-streams` 默认 4，`--multi-thread-cutoff` 默认 256M）。
- 按产品取舍：**P3 先做单文件并行**，P4 再做多文件并行。
- HDD 并行会因寻道变慢，因此按硬盘类型区分：HDD 单文件不并行，SSD / NVMe 才启用。

### 方案

- 触发条件：单文件 ≥ 阈值（建议 64MB）且源、目标都不是机械盘；否则回退现有顺序流。
- 分块：8MB / 块；并发数 = 「复制线程数」，默认逻辑处理器一半，范围 1..n；并发 1 即顺序。
- 实现：`FileHandle.read/write` 按偏移并行读写 tmp；任务队列、块边界暂停/取消；完成后整体哈希校验（P2 池）再 rename。
- 磁盘类型：
  - `disk-type.ts` 自动检测：Windows PowerShell `MSFT_PhysicalDisk.MediaType`、Linux sysfs `rotational`、macOS `diskutil info`；按根路径缓存。
  - 手动覆盖：设置「磁盘类型：自动 / 固态 / 机械」；未知按机械处理（安全回退）。
  - 源或目标任一侧是机械盘 → 单文件不并行。
- 进度：聚合字节、总速度、总 ETA（沿用 P1 后台计算）；总字节 = 文件大小。
- 续传：并行写是乱序的，现有“从偏移续写”不适用；需要决定是否做位图记录，或并行模式取消后下次重头复制。
- 设置：主界面 gear 弹窗「复制线程数」+ 「磁盘类型」；存 `app_settings.copyThreads` / `diskMode`。

### 待确认

- 阈值 64MB、分块 8MB 是否合适？（rclone 是 256MB / 4 流）
- 2 核机器默认一半 = 1，单文件并行等于关闭；SSD 是否改为 `max(2, 一半)`？
- 并行模式取消后：保留 tmp 但下次重头复制，还是做位图续传？（推荐先不做位图，重头复制；顺序模式仍保留续传）
- 磁盘类型自动检测失败/未知时按机械处理，是否接受？
- 是否需要手动「磁盘类型」覆盖，还是只自动检测？

### 实施阶段（待确认后拆）

- [ ] `disk-type.ts`（三平台检测 + 缓存 + 手动覆盖）
- [ ] `copy-parallel.ts`（8MB 偏移读写、任务队列、暂停/取消）
- [ ] 复制入口按磁盘类型与阈值选择顺序 / 并行
- [ ] 帧校验（P2 池）+ rename
- [ ] `copyThreads` / `diskMode` 设置 + gear 弹窗
- [ ] 单测（检测解析、并行复制、取消）/ e2e / 文档

## P4 多文件并行复制（方案待定）

- 文件级并行：N 个文件同时复制，默认逻辑处理器一半，范围 1..n；HDD 上降到 1–2。
- 与 P3 的组合策略待定：避免「文件数 × 单文件分块数」把 IO 打爆；可能只在队列里只剩少量大文件时启用单文件分块并行。
- 进度：`SyncAction.sizeBytes` + 聚合总字节 / 总速度 / 总 ETA；小窗显示「N 个文件并行」。
- 校验流水线、暂停/取消、失败隔离、冲突预检同前。
- 待 P3 落地后再细化。

### 已否决 / 暂不做

- 只把 `HASH_CONCURRENCY` 从 8 改成 2–4 而不移 worker：仍是猜参数，弱机依旧有主线程突刺。
- 按磁盘类型自动调线程在无法检测时强行猜测：未知按机械（顺序）处理，提供手动覆盖。
- 在 HDD 上做单文件分块并行：寻道会拖慢整体。