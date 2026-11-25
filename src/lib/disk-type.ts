import { parse } from "node:path";
import koffi from "koffi";
import type { DiskKind, DiskMode } from "./types";

export type { DiskKind };

/* Win32 seek penalty：直接查卷句柄，避免 PowerShell 冷启动 */
const IOCTL_STORAGE_QUERY_PROPERTY = 0x002d1400;
const STORAGE_DEVICE_SEEK_PENALTY_PROPERTY = 7;
const PROPERTY_STANDARD_QUERY = 0;
const FILE_SHARE_READ_WRITE = 0x00000001 | 0x00000002;
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

/** 卷句柄查 seek penalty：无寻道惩罚即 SSD，其余（含失败）一律 other */
export function detectDiskType(root: string, mode: DiskMode = "auto"): DiskKind {
  if (mode !== "auto") return mode;
  if (process.platform !== "win32") return "other";

  const letter = parse(root)
    .root.replace(/[^A-Za-z]/g, "")
    .slice(0, 1);
  if (!/^[A-Za-z]$/.test(letter)) return "other";

  const handle = CreateFileW(
    `\\\\.\\${letter}:`,
    0,
    FILE_SHARE_READ_WRITE,
    null,
    OPEN_EXISTING,
    0,
    null,
  );
  if (!handle || handle === -1 || handle === 0xffffffff || handle === 0xffffffffffffffffn) {
    return "other";
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
    return ok && !descriptor.IncursSeekPenalty ? "ssd" : "other";
  } finally {
    CloseHandle(handle);
  }
}
