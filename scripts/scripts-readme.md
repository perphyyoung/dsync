# scripts 说明

| 脚本 | 用途 | 运行方式 |
| --- | --- | --- |
| `probe-disk-kind.mjs` | 验证 koffi 查询 Windows 卷句柄的 SSD / 其他类型 | `pnpm exec node scripts/probe-disk-kind.mjs C D F` |

## probe-disk-kind.mjs

直接对 `\\.\X:` 卷句柄调用 `IOCTL_STORAGE_QUERY_PROPERTY` 的 `StorageDeviceSeekPenaltyProperty`，不走 PowerShell / CIM。

输出每行 JSON：

- `drive`：盘符
- `kind`：`ssd`（`IncursSeekPenalty=0`）或 `other`
- `detail`：错误码或 seek penalty 结果
- `elapsedMs`：本次探测耗时

依赖 `koffi`（运行时依赖）；Windows 专用。应用内对应逻辑在 `src/lib/disk-type.ts` 的 `detectWindows`。
