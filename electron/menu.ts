import { Menu, type MenuItemConstructorOptions } from "electron";
import type { RecentPair } from "../src/lib/types";

export interface MenuHooks {
  onLoadRecent: (pair: RecentPair) => void;
}

function shorten(value: string): string {
  return value.length > 44 ? `${value.slice(0, 20)}…${value.slice(-20)}` : value;
}

function recentLabel(pair: RecentPair): string {
  return `${shorten(pair.left)}  ⇄  ${shorten(pair.right)}`;
}

/** 菜单随最近目录对变化重建；最近列表为空时给一条禁用的占位项 */
export function applyAppMenu(recent: RecentPair[], hooks: MenuHooks): void {
  const recentSubmenu: MenuItemConstructorOptions[] =
    recent.length === 0
      ? [{ label: "（暂无记录）", enabled: false }]
      : recent.map((pair) => ({
          label: recentLabel(pair),
          click: () => hooks.onLoadRecent(pair),
        }));

  const template: MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        { label: "最近目录对", submenu: recentSubmenu },
        { type: "separator" },
        { role: "quit", label: "退出" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
