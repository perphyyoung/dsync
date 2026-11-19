import { describe, expect, it } from "vitest";
import {
  blockDeviceName,
  parseMacSolidState,
  parseRotational,
  parseWindowsMediaType,
} from "./disk-type";

describe("磁盘类型解析", () => {
  it("Windows MediaType", () => {
    expect(parseWindowsMediaType("SSD")).toBe("ssd");
    expect(parseWindowsMediaType("HDD")).toBe("hdd");
    expect(parseWindowsMediaType("Unspecified")).toBe("unknown");
    expect(parseWindowsMediaType(null)).toBe("unknown");
  });

  it("macOS Solid State", () => {
    expect(parseMacSolidState("Solid State: Yes")).toBe("ssd");
    expect(parseMacSolidState("Solid State: No")).toBe("hdd");
    expect(parseMacSolidState("something else")).toBe("unknown");
  });

  it("Linux rotational", () => {
    expect(parseRotational("0\n")).toBe("ssd");
    expect(parseRotational("1\n")).toBe("hdd");
    expect(parseRotational("x")).toBe("unknown");
  });

  it("块设备名去掉分区后缀", () => {
    expect(blockDeviceName("/dev/nvme0n1p1")).toBe("nvme0n1");
    expect(blockDeviceName("/dev/mmcblk0p1")).toBe("mmcblk0");
    expect(blockDeviceName("/dev/sda1")).toBe("sda");
    expect(blockDeviceName("/dev/dm-0")).toBe("dm-0");
  });
});
