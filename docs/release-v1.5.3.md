## 水杉阅读 v1.5.3

本次是**阅读页顶栏布局修复**：把右上角的章节/页码标签从悬浮层改为顶栏内嵌，彻底解决控制条唤出时标签压住正文大标题的问题。朗读、工具箱、法律文案、权限、隐私弹窗均未改。

### 修复内容

v1.5.1 起右上角位置标签是一个 `position:fixed; top:56px` 的悬浮胶囊，当正文首行是大标题时，标签会压在标题后半段上。v1.5.3 弃用悬浮层，改为**顶栏 flex 布局内嵌**：

- 顶栏布局：`← 书架` ｜ 居中章节名 ｜ **右上角页码** ｜ `目录`
- 章节名由居中的标题区呈现，右上角只补 `第 X/Y 页`，两者各出现一次、不重复、不截断
- 标签处在顶栏布局流内，不覆盖正文；沉浸态（隐藏控制条）随顶栏一起隐藏，零遮挡
- 翻页时页码自动更新

悬浮 `#pro-loc` 的 DOM 节点、更新逻辑与 fixed 样式已整套移除。Service Worker 缓存 `inkreader-v26 → v27`，`css/style.css`、`css/pro.css` 已从复用列表摘出，确保老用户升级后拿到新布局。

### 版本信息

- versionName `1.5.3` / versionCode `38`；Service Worker 缓存 `inkreader-v27`
- 包名 `com.rayyang.metasequoia`，APK Signature Scheme v2
- 权限仅 `INTERNET`（+ AndroidX 自动合并权限），**无 CAMERA**
- v1.4.8 首启隐私弹窗与五份法律文案一字未改

### 验证

- `npm test` 全量闸门 EXIT=0；`test/pro.mjs` 25/25 通过
- 真实浏览器渲染确认：顶栏内嵌布局、页码随翻页更新、沉浸态隐藏、正文标题无遮挡
- 三份 Web 资源（www / assets/www / assets/public）md5 三方一致
- `clean assembleRelease` BUILD SUCCESSFUL；解包 APK 确认新代码在包内、无旧 `#pro-loc` 残留
- 启动图标 5 档密度满格、0 透明角

📦 安装包：`Metasequoia-v1.5.3-release.apk`
