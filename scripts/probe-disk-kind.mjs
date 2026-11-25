import { performance } from "node:perf_hooks";

const koffi = (await import("koffi")).default;

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
const GetLastError = kernel32.func("uint32_t __stdcall GetLastError()");

function normalizeDrive(input) {
  const match = /^([A-Za-z]):?/.exec(input.trim());
  if (!match) throw new Error(`无效盘符：${input}`);
  return match[1].toUpperCase();
}

function isInvalidHandle(handle) {
  return !handle || handle === -1 || handle === 0xffffffff || handle === 0xffffffffffffffffn;
}

function probeDrive(input) {
  const drive = normalizeDrive(input);
  const startedAt = performance.now();
  const devicePath = `\\\\.\\${drive}:`;
  const handle = CreateFileW(
    devicePath,
    0,
    FILE_SHARE_READ | FILE_SHARE_WRITE,
    null,
    OPEN_EXISTING,
    0,
    null,
  );

  if (isInvalidHandle(handle)) {
    return {
      drive,
      kind: "other",
      detail: `CreateFileW failed: ${GetLastError()}`,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
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

    if (!ok) {
      return {
        drive,
        kind: "other",
        detail: `DeviceIoControl failed: ${GetLastError()}`,
        elapsedMs: Math.round(performance.now() - startedAt),
      };
    }

    return {
      drive,
      kind: descriptor.IncursSeekPenalty ? "other" : "ssd",
      detail: `IncursSeekPenalty=${descriptor.IncursSeekPenalty} bytes=${bytesReturned[0]}`,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    CloseHandle(handle);
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("用法：pnpm exec node scripts/probe-disk-kind.mjs C D F");
  process.exit(1);
}

for (const arg of args) {
  try {
    console.log(JSON.stringify(probeDrive(arg)));
  } catch (error) {
    console.log(
      JSON.stringify({
        drive: arg,
        kind: "other",
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
