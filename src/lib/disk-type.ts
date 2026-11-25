import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { basename, parse } from "node:path";
import type { DiskMode } from "./types";

export type DiskKind = "ssd" | "hdd" | "unknown";

/** 命令行探测超时：探测失败按机械盘（顺序）处理，不能拖住复制 */
const DETECT_TIMEOUT_MS = 3000;

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

  const script =
    `$d = Get-Partition -DriveLetter ${letter} | Get-Disk; ` +
    `(Get-PhysicalDisk | Where-Object DeviceId -eq $d.Number).MediaType`;
  return parseWindowsMediaType(
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]),
  );
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
