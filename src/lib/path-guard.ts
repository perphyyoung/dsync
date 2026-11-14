import { isAbsolute, relative, resolve, sep } from "node:path";

/** Windows 下大小写不敏感；只用它做比较，不要用它做展示 */
export function pathKey(input: string): string {
  return input.toLowerCase();
}

/** 去掉末尾分隔符，保留盘符根（C:\）原样 */
export function normalizeRoot(root: string): string {
  const resolved = resolve(root);
  if (resolved.length > 3 && resolved.endsWith(sep)) return resolved.slice(0, -1);
  return resolved;
}

export function isSameOrAncestor(ancestor: string, descendant: string): boolean {
  const a = pathKey(normalizeRoot(ancestor));
  const d = pathKey(normalizeRoot(descendant));
  if (a === d) return true;
  return d.startsWith(`${a}${sep}`);
}

/** 两个根目录不能相同，也不能互相包含，否则递归扫描会自噬 */
export function assertValidRootPair(left: string, right: string): void {
  if (!left.trim() || !right.trim()) throw new Error("必须选择左右两个目录");
  if (isSameOrAncestor(left, right) || isSameOrAncestor(right, left)) {
    throw new Error("两个目录不能相同，也不能互相包含");
  }
}

const DRIVE_PREFIX = /^[a-zA-Z]:/;

/** 只接受 a/b/c 形式；绝对路径、盘符、. 与 .. 一律拒绝 */
export function assertSafeRelative(rel: string): void {
  if (!rel || isAbsolute(rel) || rel.startsWith("/") || DRIVE_PREFIX.test(rel)) {
    throw new Error(`非法相对路径: ${rel}`);
  }
  for (const part of rel.split("/")) {
    if (!part || part === "." || part === "..") throw new Error(`非法相对路径: ${rel}`);
  }
}

export function resolveInsideRoot(root: string, rel: string): string {
  assertSafeRelative(rel);
  const full = resolve(root, rel.split("/").join(sep));
  if (!isSameOrAncestor(root, full)) throw new Error(`路径越出根目录: ${rel}`);
  return full;
}

export function toPosix(input: string): string {
  return input.split(sep).join("/");
}

export function relativePosix(root: string, full: string): string {
  return toPosix(relative(root, full));
}
