/** 后缀统一成小写、带前导点的形式，支持 .tar.gz 这类复合后缀 */
export function normalizeExts(raw: string[]): string[] {
  const seen = new Set<string>();
  for (const item of raw) {
    const trimmed = item.trim().toLowerCase();
    if (!trimmed) continue;
    seen.add(trimmed.startsWith(".") ? trimmed : `.${trimmed}`);
  }
  return [...seen];
}

/** 从 "md .ts,.js" 这类输入解析出后缀列表 */
export function parseExtInput(input: string): string[] {
  return normalizeExts(input.split(/[,;\s]+/));
}

/** 名字是否命中任一后缀 */
export function extMatch(name: string, exts: string[]): boolean {
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}
