/** electron-vite 的 Node worker 入口：?modulePath 返回打包后的 worker 文件路径 */
declare module "*?modulePath" {
  const modulePath: string;
  export default modulePath;
}
