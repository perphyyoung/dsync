import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { basename, parse } from "node:path";
import koffi from "koffi";
import type { DiskKind, DiskMode } from "./types";

export type { DiskKind };

/** 命令行探测超时：探测失败按机械盘（顺序）处理，不能拖住复制 */
const DETECT_TIMEOUT_MS = 3000;

/* Win32 seek penalty：直接查卷句柄，避免 PowerShell 冷启动 */
const IOCTL_STORAGE_QUERY_PROPERTY = 0x002d1400;
const STORAGE_DEVICE_SEEK_PENALTY_PROPERTY = 7;
const PROPERTY_STANDARD_QUERY = 0;
const FILE_SHARE_READ = 0x00000001;
const FILE_SHARE_WRITE = 0x00000002;
const OPEN_EXISTING = 3;

const kernel32 = koffi.load("kernel32.dll");
const STORAGE_PROPERTY_QUERY = koffi.struct("STORAGE_PROPERTY_QUERY", {
  PropertyId: "uint32_t",
  QueryType: "uint32_t",
  AdditionalParameters: "uint8_t[1]",
});
const DEVICE_SEEK_PENALTY_DESCRIPTOR = koffi.struct("DEVICE_SEEK_PENALTY_DESCRIPTOR", {
  Version: "uint32_t",
  Size: "uint32_t",
  IncursSeekPenalty: "uint8_t",
});
const CreateFileW = kernel32.func(
  "uintptr_t __stdcall CreateFileW(str16 lpFileName, uint32_t dwDesiredAccess, uint32_t dwShareMode, void *lpSecurityAttributes, uint32_t dwCreationDisposition, uint32_t dwFlagsAndAttributes, void *hTemplateFile)",
);
const DeviceIoControl = kernel32.func(
  "int32_t __stdcall DeviceIoControl(uintptr_t hDevice, uint32_t dwIoControlCode, const STORAGE_PROPERTY_QUERY *lpInBuffer, uint32_t nInBufferSize, _Out_ DEVICE_SEEK_PENALTY_DESCRIPTOR *lpOutBuffer, uint32_t nOutBufferSize, _Out_ uint32_t *lpBytesReturned, void *lpOverlapped)",
);
const CloseHandle = kernel32.func("int32_t __stdcall CloseHandle(uintptr_t hObject)");

function run(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: DETECT_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : stdout);
    });
  });
}

export function parseWindowsMediaType(output: string | null): DiskKind {
  if (!output) return "unknown";
  const value = output.trim().toLowerCase();
  if (value.includes("ssd")) return "ssd";
  if (value.includes("hdd") || value.includes("fixed hard disk")) return "hdd";
  return "unknown";
}

export function parseMacSolidState(output: string | null): DiskKind {
  if (!output) return "unknown";
  const match = /Solid State:\s*(Yes|No)/i.exec(output);
  if (!match) return "unknown";
  return match[1]?.toLowerCase() === "yes" ? "ssd" : "hdd";
}

export function parseRotational(output: string | null): DiskKind {
  if (!output) return "unknown";
  const value = output.trim();
  if (value === "0") return "ssd";
  if (value === "1") return "hdd";
  return "unknown";
}

/** /dev/nvme0n1p1 → nvme0n1；/dev/sda1 → sda；/dev/dm-0 → dm-0 */
export function blockDeviceName(device: string): string {
  const name = basename(device);
  if (/^(nvme\d+n\d+|mmcblk\d+)p\d+$/.test(name)) return name.replace(/p\d+$/, "");
  if (/^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+)\d+$/.test(name)) {
    return name.replace(/\d+$/, "");
  }
  return name;
}

async function detectWindows(root: string): Promise<DiskKind> {
  const parsedRoot = parse(root).root;
  if (parsedRoot.startsWith("\\\\")) return "unknown";
  const letter = parsedRoot.replace(/[^A-Za-z]/g, "").slice(0, 1);
  if (!/^[A-Za-z]$/.test(letter)) return "unknown";

  const handle = CreateFileW(
    `\\\\.\\${letter}:`,
    0,
    FILE_SHARE_READ | FILE_SHARE_WRITE,
    null,
    OPEN_EXISTING,
    0,
    null,
  );
  if (!handle || handle === -1 || handle === 0xffffffff || handle === 0xffffffffffffffffn) {
    return "unknown";
  }
  try {
    const query = {
      PropertyId: STORAGE_DEVICE_SEEK_PENALTY_PROPERTY,
      QueryType: PROPERTY_STANDARD_QUERY,
      AdditionalParameters: Uint8Array.from([0]),
    };
    const descriptor = { Version: 0, Size: 0, IncursSeekPenalty: 0 };
    const bytesReturned = [0];
    const ok = DeviceIoControl(
      handle,
      IOCTL_STORAGE_QUERY_PROPERTY,
      query,
      koffi.sizeof(STORAGE_PROPERTY_QUERY),
      descriptor,
      koffi.sizeof(DEVICE_SEEK_PENALTY_DESCRIPTOR),
      bytesReturned,
      null,
    );
    if (!ok) return "unknown";
    return descriptor.IncursSeekPenalty ? "hdd" : "ssd";
  } finally {
    CloseHandle(handle);
  }
}

async function detectLinux(root: string): Promise<DiskKind> {
  const source = (await run("findmnt", ["-no", "SOURCE", "--target", root]))?.trim();
  if (!source || !source.startsWith("/dev/")) return "unknown";
  const resolved = await realpath(source).catch(() => source);
  const name = blockDeviceName(resolved);
  const rotational = await readFile(`/sys/block/${name}/queue/rotational`, "utf8").catch(
    () => null,
  );
  return parseRotational(rotational);
}

async function detectMac(root: string): Promise<DiskKind> {
  return parseMacSolidState(await run("diskutil", ["info", root]));
}

/**
 * 探测根目录所在物理盘类型；auto 失败返回 unknown（调用方按机械盘处理）。
 * 手动 ssd / hdd 直接返回，不执行命令。
 */
export async function detectDiskType(root: string, mode: DiskMode = "auto"): Promise<DiskKind> {
  if (mode === "ssd" || mode === "hdd") return mode;
  try {
    if (process.platform === "win32") return await detectWindows(root);
    if (process.platform === "darwin") return await detectMac(root);
    if (process.platform === "linux") return await detectLinux(root);
  } catch {
    return "unknown";
  }
  return "unknown";
}
