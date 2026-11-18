# todo

本文件仅供临时性的进度追踪，其它文件不得引用。

## 执行进度小窗（复制进度 / 暂停 / 取消 / 最小化）

### 需求结论

- 单行与批量执行统一走执行进度小窗（非全屏），显示复制进度，支持暂停、继续、取消、最小化。
- 大文件显示字节进度；小文件只显示动作级进度。
- 取消需确认：已完成的动作保留，当前文件丢弃并删除 `.dsynctmp`。
- 完成后小窗 1.5s 自动关闭，Toast 报结果；失败 / 陈旧仍走告警条。

### 同类软件调研（借鉴点）

| 软件 | 做法 | 借鉴 |
| --- | --- | --- |
| TeraCopy | 自研引擎、断点续传（记录偏移）、暂停/恢复、CRC 校验、失败项重试 | 暂停在块边界保留 offset；失败可重试（后续）；速度/ETA |
| Windows CopyFileEx | 进度回调 CopyProgressRoutine，回调可取消/暂停/限速 | 块级回调 + 标志位 |
| FreeFileSync | 事务式复制（tmp + 原子替换）、暂停/停止、短任务延迟显示进度 | 已有 tmp+rename；小窗延迟 300ms 出现 |
| rclone | `--progress` 500ms 刷新（百分比/速度/ETA）、`--partial` 续传、限速 | 节流推送；速度/ETA；限速（后续） |
| rsync | 默认中断删半成品，`--partial` 保留续传 | 取消默认删 tmp；保留续传（后续） |
| Syncthing / WinSCP | 临时文件命名 + 完成 rename + 定期清理/续传 | 启动清理过期 `.dsynctmp`（后续） |

### 方案

1. 主进程任务化：`ExecutionController`（paused/cancelled + waitIfPaused/throwIfCancelled）；新增 IPC `sync:execute-pause` / `-resume` / `-cancel` 与事件 `sync:execute-progress`；同一时刻只允许一个执行任务。
2. 复制实现：`< 4MB` 用 `fs.copyFile`（动作级进度）；`>= 4MB` 用 open + 分块读写（默认 1MB/块），块边界检查暂停/取消，按块上报字节进度；复制到 `.dsynctmp` 后 rename。
3. 进度模型：`{ done, total, currentPath, fileBytesDone, fileBytesTotal }`；节流：每 100ms 或每 1MB 推送。
4. 小窗：右下角浮层 `ExecuteProgressWindow.vue`；总进度条 + 当前文件字节进度 + 速度/剩余时间；按钮 暂停/继续、取消、最小化；最小化为胶囊；延迟 300ms 出现；完成 1.5s 自动关闭。
5. 取消：ConfirmBubble 确认；中断当前文件并删除 tmp；已完成保留；结果带 `cancelled` 标记。
6. 单测：进度回调、暂停继续、取消清理 tmp、小文件分支；e2e：大文件执行小窗、最小化/恢复（暂停/取消以单测为主）。
7. 文档：design（执行进度窗、暂停/取消语义）、起步方案（IPC 表 + 执行流程）、通用语言（执行进度窗）、e2e-readme。

### 调研结论（分块大小与 4MB 阈值）

#### 分块 / 缓冲参考

| 实现 | 值 | 说明 |
| --- | --- | --- |
| Node 流默认 | 64KB（highWaterMark） | 调优文章常用 1MB |
| rclone | `--buffer-size` 16MiB / `--multi-thread-write-buffer-size` 128KiB / 多线程 chunk 64MiB | 网络场景偏大 |
| rsync | `--block-size` 默认 700B（delta 校验块，非 I/O 缓冲） | I/O 缓冲为 32–256KB 级 |
| Syncthing | 块 128KiB–16MiB（按文件大小分 1000–2000 块） | 便于断点续传 |
| TeraCopy / CopyFileEx | 内部缓冲未公开 | 回调按块推进 |
| `fs.copyFile` / `fs.cp` | 内核拷贝（copy_file_range 等） | 比流式快，但无进度 |

#### 4MB 单文件耗时估算

| 介质 | 吞吐 | 4MB 耗时 |
| --- | --- | --- |
| NVMe | 2GB/s | ~2ms |
| SATA SSD | 500MB/s | ~8ms |
| HDD | 150MB/s | ~27ms |
| 千兆网络 | 110MB/s | ~36ms |
| 百兆网络 | 11MB/s | ~364ms |

1MB 块在百兆网络约 90ms/块，暂停响应 < 0.1s，可接受。

#### 结论

- 分块定 1MB：暂停/取消响应 NVMe 0.5ms / HDD 7ms / 百兆 90ms；syscall 与 JS 开销低。
- 4MB 阈值合理：本地盘与千兆网络 < 40ms，用户无感；百兆 / SMB 才可感知。阈值再小会让更多本地文件走流式，额外开销换来很小收益。
- 保持小文件 `copyFile`（快）+ 大文件 1MB 分块（可控）；节流 100ms；小窗延迟 300ms 出现。

### 待调研

- [x] 分块大小：各工具 / 运行时默认值（Node 流、rsync、rclone、FreeFileSync、Syncthing）与实际吞吐数据。
- [x] 4MB 阈值是否合理：本地 SSD / 机械盘 / 网络盘上的耗时对比与用户感知阈值。

### 实施阶段

- [x] 分块与阈值定稿（1MB 块 / 4MB 阈值）
- [x] ExecutionController + execute 分块复制
- [x] main/preload IPC
- [x] ExecuteProgressWindow + App 接入
- [x] 单测 / e2e
- [x] 文档四件套

### 进度记录

- 2026-11-18：方案与借鉴点记录；完成分块大小与 4MB 阈值调研（结论见上）；分块定 1MB、阈值保持 4MB。
- 2026-11-18：实现完成。新增 `execute-controller.ts`（暂停/取消）、`execute.ts` 分块复制与进度、IPC 3 个控制接口 + 进度事件、`ExecuteProgressWindow.vue`（延迟 300ms、最小化胶囊、取消确认、速度/ETA）；单测 121 条（新增 8 条）、e2e 18 条（新增 09 大文件进度窗）全绿；文档 design / 起步方案 D46 / 通用语言 / e2e-readme 已同步。
