# Nuvio

给 Codex Desktop 注入一层可交互的 WebGL 动态背景：自定义背景图、Tripo 导出的 GLB 模型、鼠标视差、辉光、粒子、模型自转，以及半透明的 Codex 面板。

Nuvio 是项目的新名字（原代号 Codex Dynamic Background）。改名只影响公开品牌，本地存储键、壁纸库目录和配置格式都保持不变，升级不会丢失已经调好的画面。

**中文** | [English](README.en.md)

![Nuvio](docs/screenshots/hero.jpg)

![背景铺满整窗，侧栏与输入框保持半透明](docs/screenshots/workspace.jpg)

> 截图取自项目自带的演示界面（`npm run dev`）：背景是一张程序化生成的抽象图，界面为内置 Codex 模拟面板，**不含任何用户壁纸或聊天内容**。
> 真实注入后效果一致：背景铺满整窗，侧栏、聊天区与输入框全部半透明，顶部渐变白线已关闭。

![Nuvio 真实环境 · 奶蛙壁纸，完整拉伸铺满不裁剪](docs/screenshots/nestwave.jpg)

> 真实 Codex 环境演示：奶蛙壁纸按 `拉伸铺满` 完整显示，不裁剪。壁纸原图作者：**小涂真纪-**，仅作界面效果演示。

---

## 特性

- **整窗背景层**：背景渲染在 Codex 窗口最底层，不遮挡交互，不接管鼠标事件。
- **背景图 / 背景视频 / 场景壁纸 / 网页壁纸**：WebP / PNG / JPG、MP4 / WebM、Wallpaper Engine `scene` 壁纸，或直接嵌入 `web` 类型的单文件 HTML 壁纸。
- **场景效果回放**：自动解包 `scene.pkg`，按 Wallpaper Engine 的顺序复刻
  `shake`、`foliagesway`、`waterwaves`、`waterripple`、`waterflow`；水波、涟漪和
  水流共用同一套 UV / 法线管线，不再把整张场景降级成静态图。
- **Tripo / glTF 模型**：GLB、glTF 直接加载，自动居中、按包围盒缩放，兼容 Draco、Meshopt、KTX2。
- **动态效果**：模型自转、鼠标倾斜、Bloom 辉光、粒子、暗角、颗粒、点击波纹。
- **可调参数**：画质档位、动态强度、视差、辉光、颗粒、压暗、模型缩放/位置/自转、面板透明度。
- **设置面板直接换素材**：图片、视频、单文件 GLB 直接选择或拖入，不用命令行；素材存本机 IndexedDB，刷新后仍保留。
- **创意工坊**：自动扫描本机 Wallpaper Engine 已下载壁纸（`431960`），卡片预览、一键导入、应用和删除；不联网、不自动下载。
- **本地壁纸库**：导入后的视频 / scene 壁纸按 workshop ID 存到 `public/assets/library/<id>/`，`active.json` 记录当前生效壁纸，刷新和重新注入后自动恢复。
- **三种填充方式**：图片、视频和 scene 壁纸都支持 `跟随原图` / `裁剪铺满` / `拉伸铺满`；`stretch` 完整显示整张壁纸，不裁剪。
- **轻量性能档**：省电 / 平衡 / 高画质三档，默认省电；持续低帧时自动降一档，静态壁纸可停帧，尽量不拖慢 Codex。
- **桌面壁纸模式**：选择图片、视频或 scene 壁纸后自动进入，去掉额外毛玻璃和叠加暗角；壁纸接管画面后不再叠加主题，避免配色互相污染。
- **注入模式也能设置**：右下角齿轮或 `G` 打开 compact 面板，支持导出/导入 JSON 配置。
- **Codex 透明化**：主面板、左右侧栏改为半透明；壁纸模式下关闭 Codex 工作区伪元素遮罩和毛玻璃，设置页仍回退为不透明。
- **设置持久化**：参数写入 `localStorage`，下次注入自动恢复。
- **运行时注入**：通过 Chrome DevTools Protocol 注入，不修改 Codex 安装目录里的任何文件；常驻注入器保证刷新后仍然生效。
- **轻量注入**：常驻注入器用本地 HTTP + gzip + ETag 缓存运行时（约 210 KB 传输），页面刷新只重新执行一个小 loader，不再反复通过 CDP 发送整套 bundle；本地服务不可用时自动回退到内联 bundle。
- **诊断与恢复**：`npm run doctor` 检查构建、素材、CDP 和注入状态；`npm run restore` 一键撤销背景并清理配置。
- **无素材可跑**：没有背景图和模型时自动使用程序化背景 + 水晶占位模型。
- **零后端**：所有资源本地加载，不上传、不联网、无遥测。

## 环境要求

| 项目 | 要求 |
| --- | --- |
| Node.js | >= 22 |
| Codex Desktop | Electron 版（Windows 为主，macOS/Linux 脚本为实验性） |
| 浏览器 | 支持 WebGL2 的 Chromium |
| 操作系统 | Windows 10/11（主支持）；macOS / Linux 可跑预览，注入路径需自行调整 |

## 快速开始

```bash
git clone https://github.com/QYH1219/Nuvio.git
cd Nuvio
npm install
npm run dev
```

打开 <http://127.0.0.1:5273/>。

首次运行会自动把 Three.js 自带的 Draco / Basis 解码器复制到 `public/vendor/`，这个目录是生成物，不提交到仓库。
如果页面、CDP 或素材行为异常，先跑 `npm run doctor` 看检查结果。

仓库**不包含任何壁纸素材**。`public/assets/` 里的图片、视频、scene 壁纸和
GLB 模型默认被 `.gitignore` 忽略；clone 后先看到的是程序化占位背景。用自己的
素材运行 `npm run use -- <文件或目录>`，或把文件放进 `public/assets/`。

### 一键启动（Windows 推荐）

不想记命令就直接双击仓库根目录的 `start.cmd`，或在终端运行：

```bash
npm start
```

启动器会按顺序完成：安装缺失依赖 → 构建注入包 → 检查 CDP → 必要时带调试端口启动 Codex → 注入并常驻。第一次运行会慢一些，之后是秒级。注入器默认转入后台隐藏运行，不再占用一个常驻命令行窗口；需要看实时日志时加 `--foreground`。

#### 桌面快捷方式

桌面只保留一个快捷方式，双击就是完整流程：启动器会自己判断 Codex 是否在运行、有没有调试端口；需要时会询问是否带 `--remote-debugging-port` 重新拉起一次，然后注入并常驻。壁纸选择和画面参数保存在本地，重启不会把已经调好的画面重置。

```powershell
npm run shortcut              # 创建唯一的「Nuvio」快捷方式
npm run shortcut -- --remove  # 删掉它
npm run shortcut -- --dry-run # 只看会写入什么，不创建文件
```

生成的快捷方式带仓库自带的 `public/icon.ico`，工作目录指向仓库根目录，所以从任何位置双击都能跑。启动窗口默认最小化，点任务栏图标可以看日志。

- 已经在运行但没有调试端口的 Codex 默认会先询问；`npm start -- --yes` 直接同意，`npm start -- --restart` 跳过询问自动重启，`npm start -- --no-restart` 保留当前窗口。当前壁纸始终从本地保存的素材和参数恢复。
- 常驻注入器已经在跑时，再次双击快捷方式只会复用现有实例，不会重复起端口；要强制换一个新实例用 `npm start -- --force`。
- 注入成功后注入器转入后台隐藏运行，日志写到 `.nuvio/injector.log`；要停止它用 `npm run restore`。需要前台实时日志时用 `npm start -- --foreground`。
- 只想注入、自己负责启动 Codex：`npm start -- --no-launch`；只重新构建：`npm start -- --build`。

#### 壁纸包、便携版与开机自启

```powershell
# 把当前壁纸、scene/mask、素材库条目和面板参数打成一个文件
npm run bundle -- export --name 奶蛙
# 恢复到本机（会自动应用当前配置）
npm run bundle -- import "exports/奶蛙.nuvio.zip"

# 生成免安装发布包：dist/nuvio-<version>-portable.zip
npm run pack

# 登录时自动启动（写入当前用户 Startup 文件夹，不需要管理员）
npm run autostart -- enable
npm run autostart -- status
npm run autostart -- disable
```

壁纸包默认输出到 `exports/`，运行状态和日志在 `.nuvio/`，两者都不提交到 Git。

### 预览模式

| URL | 效果 |
| --- | --- |
| `/` | 背景 + 本地 mock Codex 界面 |
| `/?mock=0` | 纯背景，无 UI |
| `/?mock=1` | 强制显示 mock Codex 界面 |
| `/?panel=1` | 启动时打开设置面板 |
| `/?embed=1` | 以嵌入模式挂载（无 HUD / mock，保留右下角齿轮和设置面板） |

快捷键：`G` 开关设置面板，`H` 隐藏/显示 HUD，`Esc` 关闭面板。

#### 场景 shader 预览（开发用）

`shader-preview.html` 是一个不依赖设置面板的调试页，用来单独验证 scene
效果链。把导出的 private fixture 放到 `public/__shader-preview__/`
（该目录已 gitignore，构建时也会被剥离），然后访问：

```text
http://127.0.0.1:5273/shader-preview.html?t=0
http://127.0.0.1:5273/shader-preview.html?t=4
```

`t` 固定动画时间，方便对同一帧做像素 diff；没有 fixture 时页面会显示提示，
不会影响正常预览和注入。

设置面板固定四个分区：

| 分区 | 内容 |
| --- | --- |
| 壁纸 | 本地文件 / 拖入、创意工坊扫描结果 |
| 外观 | 填充方式、界面不透明度、背景压暗、暗角 |
| 性能 | 画质档位、卡顿自动降档、静态壁纸停帧、动态强度、鼠标视差 |
| 高级 | 辉光、颗粒、scene 抖动/摇摆、GLB 模型 |

主题和可读性预设不再出现在面板里：选择壁纸后由壁纸接管配色，叠加主题只会让画面发灰。旧配置里的 `theme` / `readability` 仍然兼容，只对程序化背景生效。输入框、文本域和 `contenteditable` 内不会抢 `G` 快捷键。

### 在线演示（可选）

仓库自带 `.github/workflows/pages.yml`。在 GitHub 仓库的 **Settings → Pages → Build and deployment** 里把 Source 设为 **GitHub Actions**，之后 push 到 `main` 就会自动构建并部署预览站：

```text
https://qyh1219.github.io/Nuvio/
```

在线预览没有你本地的素材，会使用程序化背景和占位水晶模型；它主要用于展示交互和主题，不会暴露 `public/assets/`。

壁纸模式下，scene 壁纸默认使用 `fit: "stretch"`：整张图拉伸铺满窗口，不裁剪。
同时会隐藏 Codex 自带的顶部渐变遮罩，避免聊天区上方出现一条白色横线。

## 放入素材

### 普通用户：直接在设置面板换

按 `G` 打开设置面板，在「我的素材」里点「选择」，或把文件拖进虚线框：

| 位置 | 接受 | 上限 |
| --- | --- | --- |
| 背景 | PNG / JPG / WebP / AVIF / GIF，MP4 / WebM / MOV / M4V | 192 MB |
| 模型 | 单文件 `.glb` | 128 MB |

- 文件只保存在浏览器的 IndexedDB，不上传、不联网；刷新页面或重新注入后仍会恢复。
- 导入前会实际解码图片 / 视频 / GLB，坏文件不会覆盖上一份可用素材。
- 用户素材优先于 `public/assets`。点「×」清除后，先恢复项目里的磁盘素材；没有磁盘素材才回到程序化背景或占位水晶。
- 设置面板里的模型位置只收单文件 `.glb`。`.gltf` 依赖外部 `.bin` 和贴图，无法通过单文件选择器完整导入；需要 `.gltf` 时请用下面的磁盘方式。
- 预览站和注入后的 Codex 是两个 origin，IndexedDB 素材库互相独立。在预览站导入的素材不会自动出现在 Codex 里，反之亦然。

### 磁盘素材与命令行

一条命令安装并规范化素材，同时清掉优先级更高的旧文件（否则会出现“换了图还在放旧视频”）：

```bash
npm run use -- "C:\Pictures\my-bg.png"              # 图片 png/jpg/webp/avif
npm run use -- "C:\Videos\loop.mp4"                 # 视频 mp4/webm（mov 需 ffmpeg）
npm run use -- "C:\Models\figure.glb"               # Tripo 导出的模型
npm run use -- "D:\steam\steamapps\workshop\content\431960\3806385218"
                                                    # Wallpaper Engine 工程，自动识别 image/video/scene
npm run use -- --scene "C:\path\to\unpacked-scene"  # 已解包的 scene 目录
npm run use -- --clear                              # 只清背景，保留模型
npm run use -- --dry-run                            # 只打印计划，不动文件
```

安装后：预览模式刷新页面即可；注入模式需要重新构建，`npm run embed && npm run inject`。

也可以手动丢文件进 `public/assets/`，代码会按优先级探测：

```text
public/assets/background.webp   # 或 .png / .jpg / .jpeg
public/assets/background.mp4    # 或 .webm，优先于静态图
public/assets/model.glb         # 或 .gltf（兄弟目录需带 .bin 和贴图）
public/assets/wallpaper/scene.json  # 由 wallpaper 导入器生成
```

没有素材也能直接跑，会用程序化背景和占位模型。

模型适配规则：读取包围盒 → 居中到原点 → 最大边缩放到场景单位 `3.35` → 叠加边缘线框壳。模型本身的材质、贴图、动画会保留。

更细的素材规范见 [docs/ASSETS.md](docs/ASSETS.md)。

## 创意工坊（本机已下载壁纸）

0.3.0 新增本机 Wallpaper Engine 壁纸扫描。它只读你**已经下载**的壁纸，不访问 Steam 网络，也不会自动订阅或下载任何内容。

```bash
npm run workshop                 # 扫描本机 431960 目录并列出壁纸
npm run workshop -- --json       # 输出机器可读 JSON
npm run workshop -- --root "D:\SteamLibrary\steamapps\workshop\content\431960"
```

扫描结果包含 workshop ID、标题、类型（`video` / `scene` / `web` / `application`）、预览图路径和占用大小。常见 Steam 库位置会自动探测，也可以用 `--root` 指定。

在注入模式下打开设置面板（`G`），「壁纸」分区里的创意工坊会显示同样的卡片：

| 操作 | 行为 |
| --- | --- |
| 导入 | 把壁纸复制 / 转换到 `public/assets/library/<id>/`，视频和 scene 可能触发一次转换进度 |
| 使用 | 写入 `public/assets/active.json`，重新加载背景并切换当前壁纸 |
| 删除 | 删除该 library 条目；如果它正在使用，会清理 active 状态 |

创意工坊 API 只在 `npm start` / `npm run inject` 的常驻注入模式下可用，因为扫描和转换跑在本地 Node 进程里；`--once` 或纯预览站没有这个接口。接口只绑定 `127.0.0.1`，并校验注入器生成的临时 token。

`web` 类型会整目录复制到 `public/assets/library/<id>/web/`，在沙箱 iframe 里渲染：`pointer-events: none`，不抢点击，也不影响 Codex 的键盘输入。单文件 HTML（内嵌 data URI）最省事；带同级资源的项目也会按相对路径一起复制。`application` 是原生程序，不能嵌入，只能用它的预览视频重建。

## 从 Wallpaper Engine 复刻

Wallpaper Engine 的壁纸分三类，处理方式不同：

| `project.json` 的 `type` | 复刻方式 |
| --- | --- |
| `video` | 直接导入，作为动态背景播放；可叠加视差、辉光、粒子、模型 |
| `web` | 整目录复制后用沙箱 iframe 直接渲染，保留原 HTML/CSS/JS 动画；不支持窗口交互 |
| `scene` | 自动用 RePKG 解开 `scene.pkg`，导出主图和效果贴图；支持 `shake` / `foliagesway` / `waterwaves` / `waterripple` / `waterflow` |
| `application` | 原生程序，不能嵌入；用它的预览视频重建 |

找到壁纸目录（Steam 库）：

```text
...\steamapps\workshop\content\431960\<壁纸ID>\
```

先看类型，不复制：

```bash
npm run wallpaper -- "D:\SteamLibrary\steamapps\workshop\content\431960\123456789" --dry-run
```

导入当前正在使用的壁纸：

```bash
npm run wallpaper -- --current
```

或按 workshop ID / 目录导入：

```bash
npm run wallpaper -- 3806385218
npm run wallpaper -- "D:\SteamLibrary\steamapps\workshop\content\431960\3806385218"
```

- 视频壁纸写到 `public/assets/background.mp4|webm`。
- 场景壁纸写到 `public/assets/wallpaper/`，生成 `scene.json`、主图和 mask。
- 导入器会自动查找 Steam / Wallpaper Engine / RePKG；也可用 `--repkg` 指定 RePKG.exe。
- 已解包的 scene 目录可直接用 `--scene <目录>` 导入，不需要再次解包。
- 加 `--force` 覆盖已有输出。

当前场景 shader 复刻支持 `shake`、`foliagesway`、`waterwaves`、`waterripple` 和
`waterflow`；其他效果（`godrays`、`refraction`、`blend`、`xray` 等）会在导入时
列出并跳过，主图与已支持的效果仍会正常加载。素材版权归原作者，
`public/assets/*` 默认不提交到仓库。

## 构建

```bash
npm run build:all
```

产物：

| 路径 | 用途 |
| --- | --- |
| `dist/` | 独立预览站点 |
| `dist-embed/codex-dynamic-bg.iife.js` | 注入 Codex 用的单文件 IIFE bundle |

单独构建：

```bash
npm run build     # 预览站点
npm run embed     # 注入 bundle
npm run size      # 查看运行时 raw / gzip 体积
npm run sign      # 可选：用 signtool 给便携包签名（需 NUVIO_SIGN_CERT）
```

注入 bundle 约 810 KB（gzip 后约 212 KB）。常驻注入器默认走本地 HTTP 缓存，
浏览器只重新执行一个小 loader；断网或端口被占用时自动回退到内联 bundle。

## 注入 Codex Desktop

注入依赖 Chromium 的远程调试端口。已经在运行的 Codex 无法中途附加调试端口，必须先退出再用启动器拉起。

最省事的方式是退出 Codex 后运行 `npm start`（或双击 `start.cmd`），它会串起构建、启动 CDP、注入三步。下面是需要手动控制时的完整流程。

### 1. 关闭 Codex，带调试端口启动

Windows：

```powershell
npm run launch:codex
```

如果 Codex 还在运行，启动器会直接报错，避免误杀你的进程。确认可以关闭时：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/launch-codex.ps1 -KillExisting
```

自定义安装路径或端口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/launch-codex.ps1 -AppPath "C:\Path\To\ChatGPT.exe" -Port 9222
```

不确定安装位置时，先加 `-DryRun` 只打印自动解析到的可执行文件路径，不启动应用。

macOS / Linux：

```bash
bash tools/launch-codex.sh
```

找不到可执行文件时，用 `CODEX_BIN="/path/to/Codex" bash tools/launch-codex.sh 9222`
指定路径。便携包解压后用 `bash start.sh` 启动，不需要 `npm install`。

### 2. 确认 CDP 可用

```bash
npm run inject -- --list
```

能看到 Codex 的 page target 就说明端口通了。

### 3. 注入

```bash
npm run embed
npm run inject
```

默认行为：

- 连接 `http://127.0.0.1:9222`
- 在 `public/assets/` 启一个本地素材服务器（默认 `5275`）
- 把 bundle 注册为 `Page.addScriptToEvaluateOnNewDocument`
- 刷新页面并校验 `#cxd-bg-root` 是否存在

注入成功后，Codex 窗口会出现动态背景。注入模式沿用 `localStorage` 里的配置，右下角会出现半透明齿轮，按 `G` 可以打开 compact 设置面板；也可以在 Console 里用 `cxdBg.setConfig()` 实时改。

注入器会**常驻运行**：它保持 CDP 连接，`Page.addScriptToEvaluateOnNewDocument` 的注册只在这个连接存活期间有效。关掉注入器窗口后，刷新页面会恢复原样。因此请保留运行 `npm run inject` 的终端，或使用下面的 `npm run restore` 停止。

### 注入器参数

```text
--port 9222          CDP 端口
--asset-port 5275    本地素材服务器端口
--control-port 5276  本地恢复控制端口（被占用时自动向后顺延）
--assets PATH        /assets/ 映射目录（默认 public/assets）
--vendor PATH        /vendor/ 映射目录（默认 public/vendor）
--bundle PATH        注入用 IIFE bundle（默认 dist-embed/codex-dynamic-bg.iife.js）
--target TEXT        按 target id / 标题 / URL 子串选择页面
--image URL          指定背景图（URL 或 /assets/... 路径）
--video URL          指定视频背景（URL 或 /assets/... 路径）
--scene URL          指定 scene.json（URL 或 /assets/... 路径）
--model URL          指定模型（URL 或 /assets/... 路径）
--surface NUMBER     面板不透明度 0..1（默认 0.22，越低背景越清晰）
--dim NUMBER         背景压暗 0..1（默认 0.12）
--asset-base URL     覆盖素材 base URL
--lazy               强制使用本地 HTTP 缓存的运行时（默认自动探测）
--full               强制使用内联 bundle（不依赖本地 HTTP）
--no-reload          注入到当前文档，不刷新
--no-serve           不启动本地素材服务器
--wait SECONDS       等待 CDP 就绪，而不是立即失败（默认 0）
--once               注入后退出，不留常驻进程（刷新后失效）
--list               列出 CDP page targets 后退出
-h, --help           帮助
```

示例：

```bash
npm run inject -- --image /assets/background.webp --model /assets/model.glb
npm run inject -- --video /assets/background.mp4
npm run inject -- --scene /assets/wallpaper/scene.json
npm run inject -- --no-reload
npm run inject -- --no-serve --asset-base https://cdn.example.com/bg/
npm run inject -- --wait 30
npm run inject -- --once
```

### 撤销注入

推荐在项目目录另开终端：

```bash
npm run restore                 # 清背景 + 清 localStorage 配置
npm run restore -- --keep-config  # 只清背景，保留主题/参数
npm run restore -- --reload     # 清理后刷新页面
```

`restore` 会优先通过 `.cxd-inject.json` 里的控制端口通知常驻注入器退出；如果注入器已经不在，则回退到直接连接 CDP 清理当前页面。极端情况下仍然残留时，彻底退出 Codex 再启动即可。

- 重启 Codex 也会恢复原样（注入只存在于当前进程）。
- 在 DevTools Console 执行 `window.cxdBg.dispose()` 只卸载当前页面，不会删除持久注入注册。

原理、时序和排错见 [docs/INJECTION.md](docs/INJECTION.md)。

## 配置

设置面板写入 `localStorage` 的 `codex-dynamic-bg:v2`。字段：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `theme` | `aurora` | `aurora` / `deep-space` / `cyber` / `rain` / `paper` / `mono` |
| `readability` | `balanced` | `wallpaper` / `clear` / `balanced` / `immersive` / `custom` |
| `wallpaperMode` | `false` | 壁纸模式状态；选择图片/视频/场景时自动置为 `true`，清除后恢复主题 |
| `quality` | `saver` | `saver` / `balanced` / `high`，控制 DPR、Bloom、粒子数量和渲染方式；旧值 `low` / `medium` 自动映射 |
| `autoQuality` | `true` | 持续低于当前档位目标帧率时自动降一档（每次会话最多一次，只降不升） |
| `idlePause` | `true` | 图片 / 静态场景壁纸无交互时停帧，减少 GPU 占用 |
| `fit` | `auto` | `auto` / `cover` / `stretch`；图片、视频、scene 壁纸都生效 |
| `motion` | `1` | 全局动态强度 |
| `parallax` | `1` | 鼠标视差强度 |
| `bloom` | `0.85` | Bloom 强度 |
| `grain` | `0.55` | 胶片颗粒 |
| `dim` | `0.12` | 背景压暗 |
| `vignette` | `0.45` | 暗角强度 |
| `modelScale` | `1` | 模型整体缩放 |
| `modelSpin` | `0.35` | 模型自转速度 |
| `modelX` / `modelY` | `0.18` / `-0.02` | 模型屏幕位置偏移 |
| `sceneShake` | `1` | 场景壁纸抖动强度 |
| `sceneSway` | `1` | 场景壁纸植被摆动强度 |
| `sceneWater` | `1` | 场景壁纸水波 / 涟漪 / 水流强度 |
| `particles` | `true` | 粒子开关 |
| `codexMock` | `true` | 预览站是否显示 mock 界面 |
| `surfaceOpacity` | `0.22` | Codex 面板透明度基准（注入时实时生效） |
| `showPanel` | `false` | 设置面板是否展开（不写入导出 JSON） |

`theme` / `readability` 只对程序化回退背景生效，0.3.0 面板不再暴露这两个选项。图片、视频或 scene 壁纸激活后由壁纸接管配色；用「外观」里的滑块直接调 `surfaceOpacity`、`dim`、`vignette`。

## JavaScript API

注入完成后页面里会有 `window.cxdBg`：

```js
// 运行时改参数（会写入 localStorage）
cxdBg.setConfig({ bloom: 1.2, modelSpin: 0.6, quality: 'balanced' });

// 切主题时会自动套用该主题的效果值，再叠加显式参数
cxdBg.setConfig({ theme: 'cyber' });

// 恢复默认值
cxdBg.reset();

// 打开 / 关闭 / 切换设置面板
cxdBg.openPanel();
cxdBg.closePanel();
cxdBg.togglePanel();

// 当前素材探测结果
console.log(cxdBg.assets);
// { imageUrl, modelUrl, sceneUrl, background: 'video'|'scene'|'image'|'placeholder', model: 'glb'|'placeholder' }

// 卸载背景层
cxdBg.dispose();
```

挂载完成时还会派发：

```js
window.addEventListener('cxdbg-ready', (event) => {
  console.log(event.detail);
});
```

## 项目结构

```text
.
├─ index.html
├─ start.cmd             # Windows 双击一键启动
├─ src/
│  ├─ main.js            # 预览站入口
│  ├─ embed.js           # 注入入口 + Codex CSS 适配
│  ├─ mount.js           # 生命周期、素材探测、API
│  ├─ library.js         # 设置面板素材库（IndexedDB、校验、对象 URL）
│  ├─ scene.js           # Three.js 场景与渲染循环
│  ├─ post.js            # Bloom / 颗粒 / 暗角
│  ├─ shaders.js         # 背景 / 模型 / 粒子 shader
│  ├─ assets.js          # 素材探测与程序化占位
│  ├─ ui.js              # HUD / 设置面板 / mock 界面
│  ├─ config.js          # 默认值 + localStorage
│  ├─ perf.js            # 帧率采样 + 自动降档
│  ├─ workshop.js        # 创意工坊 API 封装（注入模式）
│  ├─ presets.js         # 主题与可读性预设
│  ├─ style.css
│  ├─ panel/
│  │  └─ workshop.js     # 创意工坊卡片 UI
│  └─ scene/
│     ├─ background.js
│     ├─ wallpaper.js    # scene 壁纸 shader + 效果链
│     ├─ model.js        # GLB 加载、自动适配、自转
│     └─ particles.js
├─ tools/
│  ├─ inject.mjs         # CDP 注入器 + 本地素材服务器
│  ├─ library.mjs        # library 导入 / 应用 / 删除
│  ├─ workshop-scan.mjs  # 本机 Wallpaper Engine 扫描
│  ├─ start.mjs          # 一键启动：依赖 / 构建 / 启动 CDP / 注入
│  ├─ doctor.mjs         # 环境 / 构建 / 素材 / CDP 诊断
│  ├─ restore.mjs        # 常驻注入器恢复与页面清理
│  ├─ cleanup-expression.mjs # 共享的页面清理脚本
│  ├─ sync-decoders.mjs  # 复制 Draco / Basis 解码器
│  ├─ wallpaper.mjs      # Wallpaper Engine 壁纸导入 / 类型识别
│  ├─ launch-codex.ps1
│  └─ launch-codex.sh
├─ test/                 # node:test 单元测试（npm test）
│  ├─ library.test.mjs   # 素材库类型、上限与槽位规则
│  └─ ...
├─ public/assets/        # 你的背景图与模型（默认不提交）
├─ .cxd-inject.json      # 本机注入状态（自动生成，不提交）
├─ docs/
└─ .github/workflows/
```

架构说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## Tripo 模型说明

Tripo 导出的 GLB 通常可以直读。建议导出时：

- 选 **GLB**（单文件，含贴图），不要只给 OBJ。
- 贴图控制在 2K 以内，单模型建议 < 15 MB。
- 需要压缩时优先用 Draco 或 Meshopt；本项目已内置对应解码器。
- 有 PBR 贴图时确认 `baseColor` / `metallicRoughness` / `normal` 都打进 GLB。

模型加载失败不会中断页面，会回退到占位水晶，并在控制台给出原因。

## 兼容性与已知限制

- Codex 升级后 DOM class 可能变化，透明面板样式集中在 `src/embed.js` 的 `CXD_CODEX_CSS`，改这一处即可。
- 注入只对当前 Codex 进程有效，重启后需要重新执行 `npm run inject`；注入器必须常驻，否则刷新后注册失效。
- 使用 `--once` 时注入器会在成功后退，当前页面仍有效，但下一次刷新就会恢复原样。
- CDP 端口只应绑定在 `127.0.0.1`，不要暴露到局域网。
- 高画质 + 4K 背景 + 大模型会明显吃 GPU；卡顿时先降 `quality`，再关粒子。
- 背景发灰/看不清：注入时用 `--surface 0.15 --dim 0.05` 调低面板遮罩和压暗；面板越透明，背景越清晰，文字对比度会同步下降，按自己屏幕微调。
- 设置面板导入的素材与预览站不是同一份：预览站、注入后的 Codex 各自使用自己的 IndexedDB；需要两边一致时分别导入，或用 `public/assets` / `npm run use`。
- Linux / macOS 的 Codex 安装路径与进程名不同，`launch-codex.sh` 需要按实际环境改。

## 隐私

- 不收集任何数据，无网络请求（除本地素材服务器与页面自身）。
- 素材只从本地目录读取，不会上传。
- 注入脚本通过 CDP 下发，不写入 Codex 安装目录。
- 恢复控制端口只监听 `127.0.0.1`，使用每次注入随机生成的 token；状态文件 `.cxd-inject.json` 已被 `.gitignore` 忽略。

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题见 [SECURITY.md](SECURITY.md)。

## License

[MIT](LICENSE)

非官方项目，与 OpenAI 无隶属关系。Codex 名称与商标归其所有者。

