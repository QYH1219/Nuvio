# 素材目录

把素材放在这里，代码会自动探测：

- 背景视频：`background.mp4` / `background.webm`（优先于静态图）
- 背景图：`background.webp` / `background.png` / `background.jpg` / `background.jpeg`（任选其一，按此顺序）
- 场景壁纸：`wallpaper/scene.json` + 主图 + mask（由 `npm run wallpaper -- --current` 生成）
- 模型：`model.glb`，或 `model.gltf`（同级需要 `.bin` 与贴图）

没有素材时会自动使用程序化占位背景 + 水晶占位模型，不影响预览。

本目录下的素材默认被 `.gitignore` 忽略，只有这个 README 会提交。不要把没有分发授权的图片或模型提交到仓库。

详细规范见 [`docs/ASSETS.md`](../../docs/ASSETS.md)。
