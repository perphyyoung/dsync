# todo

本文件仅供临时性的进度追踪，其它文件不得引用。

## 目标

磁盘类型从应用级设置改为单目录属性，仅内存缓存，不持久化。扫描设置页路径行显示检测结果，只在 `unknown` 时允许手动指定。设置弹窗删除磁盘类型。扫描时记录盘型快照；执行前重新检测并对比，不一致弹窗确认；执行中不再探测。

## 1. 数据与类型

- [ ] `src/lib/types.ts`：`AppSettings` 删除 `diskMode`；`DiskMode` 保留 `auto | ssd | hdd`；`ScanResult` 增加 `diskKinds: { left: DiskKind; right: DiskKind }`。
- [ ] 不新增数据库表，不持久化盘型。
- [ ] 启动时 `deleteSetting("diskMode")`，旧值丢弃。

## 2. 内存缓存

- [x] 主进程维护 `Map<string, DirDiskCache>`，key 为规范化绝对路径：

```ts
interface DirDiskCache {
  mode: DiskMode;   // auto | ssd | hdd
  kind: DiskKind;   // ssd | hdd | unknown
  checkedAt: number;
}
```

- [x] 缓存生命周期到应用重启；不设 TTL。
- [x] 手动值只写内存：`mode = ssd | hdd`，`kind` 取对应值。
- [x] 「恢复自动」：`mode = auto`，删除该 root 缓存并重新检测。
- [x] 只在 `unknown` 时允许手动指定；检测为 `ssd` / `hdd` 时只读。

## 3. 主进程

- [ ] 删除 `readDiskMode`、`settings:set-disk-mode`、`appSettings().diskMode`。
- [ ] 新增 `diskModeOf(root)` 与 `diskKindOf(root)`，读缓存；缓存缺失时 `detectDiskType(root, "auto")`。
- [ ] 新增 IPC：
  - [ ] `dir:get-disk`：root → `{ mode, kind }`，缓存缺失则探测。
  - [ ] `dir:set-disk`：root + `ssd | hdd | auto` → `{ mode, kind }`；`auto` 清缓存重测。
  - [ ] `dir:check-disk-change`：`{ leftRoot, rightRoot, scanKinds }` → `{ changed, now }`，强制重新探测两侧并与快照对比。
- [ ] `sync:scan`：开始时对左右调用 `diskKindOf`，结果写入 `ScanResult.diskKinds`；已有缓存直接命中，不重复探测。
- [ ] `sync:execute`：`diskKind` 回调返回 `request.diskKinds` 快照，执行中不再调用 `detectDiskType`。
- [ ] `electron/preload.ts`、`src/types/api.d.ts`：新增 `getDirDisk` / `setDirDisk` / `checkDiskChange`，删除 `setDiskMode`。

## 4. 扫描设置页

- [ ] 左右目录行布局：`[路径 flex-1] [盘型控件] [更改]`，盘型控件在「更改」按钮左侧。
- [ ] 盘型控件显示：
  - [ ] `mode = auto` 且 `kind = ssd` / `hdd`：只读显示「SSD」/「机械」+「重新检测」。
  - [ ] `mode = auto` 且 `kind = unknown`：显示「未知」+「手动指定」下拉（固态 / 机械）。
  - [ ] `mode = ssd | hdd`：显示「手动：固态」/「手动：机械」+「恢复自动」。
- [ ] 重新检测时机：
  - [ ] 应用启动后首次打开设置页或开始扫描（缓存缺失才探测）。
  - [ ] 更改左 / 右目录。
  - [ ] 切换目录对。
  - [ ] 左右互换。
  - [ ] 点击「重新检测」。
- [ ] 竞态：请求携带 root，返回时校验当前 root 仍一致，否则丢弃。
- [ ] 新增 props / emits：`leftDisk`、`rightDisk`、`changeDirDisk(side, mode)`。
- [ ] `App.vue`：删除 `diskMode` / `saveDiskMode`；新增 `leftDisk` / `rightDisk` 与 `saveDirDisk`；打开设置页、切目录对、互换时加载。

## 5. 设置弹窗

- [ ] `AppSettingsDialog.vue`：删除磁盘类型行、`diskMode` prop、`changeDiskMode` emit、相关 import。

## 6. 盘型变化确认流程

- [x] 检查与执行分离：渲染进程执行前先调用 `dir:check-disk-change`，`execute` 不再检查盘型。
- [x] 主进程强制重新探测两侧（绕过缓存），与 `ScanResult.diskKinds` 对比。
- [x] 不一致且未静音时弹确认气泡，四个选项：
  - [x] 继续：直接调用 `execute`。
  - [x] 取消：不执行。
  - [x] 重新扫描：关闭弹窗并触发 scan。
  - [x] 重启应用前不再提醒：按目录对设置内存标记 `diskChangeMuted[pairKey] = true`，本次继续执行；同一目录对后续不再弹，直到应用重启。
- [x] 因为检查在 `execute` 之外，不需要 `confirmedDiskChange` 重入标记。
- [x] 只对有 copy 动作的批次检查；纯 move / soft-delete 不检查。

## 7. e2e 与单测

- [ ] 不新增 e2e 用例，盘型覆盖用单元测试。
- [ ] 现有 e2e 适配删除的 API：`09` / `11` 的 `setDiskMode("ssd")` 改为 `setDirDisk(left, "ssd")` / `setDirDisk(right, "ssd")`；`10` 删除磁盘类型断言与 `getByLabel("磁盘类型")`。
- [ ] 单测：
  - [ ] `evaluateDiskChange(scan, now)`：SSD→SSD、SSD→HDD、SSD→unknown、HDD→SSD。
  - [ ] `executeActions`：`diskKind` mock 序列，两侧 SSD 用设置值，任一侧 HDD/unknown 为 1。
  - [ ] 手动指定：`unknown` → `ssd` 后 `kind` 取 `ssd`；`auto` 恢复后重新探测。
  - [ ] 检测解析函数已有用例；命令失败路径按需注入。

## 8. 文档

- [ ] `design.md`：设置弹窗删除磁盘类型；扫描设置页路径行补盘型；执行前确认流程；盘型只存内存。
- [ ] `通用语言.md`：磁盘类型改为单目录属性；新增「盘型快照」「盘型变化确认」。
- [ ] `AGENTS.md`：盘型缓存与检测时机；执行前检查与执行分离。
- [ ] `README.md`：功能描述。
- [ ] `dsync起步方案.md`：新增 D65。

## 验收

- [ ] 路径行显示盘型；`unknown` 可手动指定；重启后回到自动检测。
- [ ] 设置弹窗无磁盘类型。
- [ ] 盘型与扫描快照不一致时弹窗；继续 / 取消 / 重新扫描 / 重启前不再提醒生效。
- [ ] 执行中不再探测盘型。
- [ ] `pnpm check` 通过；相关 e2e 适配后通过。

## 已确认决策

- [x] 1. 不持久化，启动后与路径变化时实时检测。
- [x] 2. 盘型放主进程内存缓存。
- [x] 3. 只在 `unknown` 时允许手动指定。
- [x] 4. 与扫描快照不一致就弹窗。
- [x] 5. 弹窗增加「重启应用前不再提醒」。
- [x] 6. 检查与执行分离，不需要 `confirmedDiskChange` 重入标记。
- [x] 7. 手动更改、切换目录对、互换、选新目录都重新检测；另有「重新检测」。
- [x] 8. 扫描前检测，点「开始扫描」不重复检测（缓存命中）。
- [x] 9. 删除旧 `app_settings.diskMode`，不迁移。
- [x] 10. 不新增 e2e，盘型用单元测试 mock 覆盖；现有 e2e 适配删除的 API。
- [x] 11. 盘型控件放「更改」按钮左侧。
- [x] 12. 手动值按绝对路径存内存，目录移动后失效，接受。

## 快照生命周期

- [x] 快照随 `ScanResult` 存内存，不持久化。
- [x] 以下场景 `result` 被清空，无法执行，因此不存在「有动作但无快照」：目录变化、切换目录对、扫描失败、取消扫描、应用重启。
- [x] 互换左右目录时 `mirrorScanResult` 交换 `diskKinds.left` / `diskKinds.right`，快照仍在。
- [x] 重试失败项沿用当前 `result`，快照仍在。
- [x] 仍可能缺失：开发热更新保留旧结果；直接调用 `execute` API（测试 / 脚本）；未来结果持久化后的旧数据。
- [x] 扫描阶段与执行阶段都重新检测；缓存只服务设置页展示与扫描前的预检。
- [x] 若执行前 `diskKinds` 仍为空（正常流程不会发生），不跳过：补一次检测，结果写回 `diskKinds` 作为新快照，返回 `{ changed: false, reason: "filled" }`，不弹窗，继续执行，并记日志。

## 已确认决策（补充）

- [x] 13. 「重启应用前不再提醒」按目录对静音。
- [x] 14. 执行前测出 `unknown`、扫描快照为 `ssd`，按不一致弹窗。
- [x] 15. 扫描与执行阶段都检测；快照若仍为空，执行前补一次检测并回填，不弹窗。
