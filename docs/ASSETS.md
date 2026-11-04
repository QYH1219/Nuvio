# Assets

## One-shot installer

`tools/use.mjs` copies an asset into the exact filename the runtime probes and
deletes the entries that would outrank it. This avoids the classic "I replaced
the image but the old video is still playing" problem.

```bash
npm run use -- "C:\Pictures\my-bg.png"
npm run use -- "C:\Videos\loop.mp4"
npm run use -- "C:\Models\figure.glb"
npm run use -- "D:\steam\steamapps\workshop\content\431960\3806385218"
npm run use -- --scene "C:\path\to\unpacked-scene"
npm run use -- --clear
npm run use -- --dry-run
```

Behavior:

- A file is classified by extension and renamed to `background.<ext>` or `model.<ext>`.
- A Wallpaper Engine project (`project.json` / `scene.pkg`) is handed to `tools/wallpaper.mjs`.
- An already-unpacked scene directory (`scene.json` without `image`) is normalized by the same importer.
- A normalized scene directory (`scene.json` with `image`) is copied to `public/assets/wallpaper/`.
- Installing any background removes the other background kinds, matching the probe order below.
- `--clear` removes image/video/scene but leaves models alone.
- `--dry-run` prints every copy and removal without touching the filesystem.

Probe order used by `src/assets.js`:

```text
video (mp4/webm) > scene (wallpaper/scene.json) > image (webp/png/jpg/jpeg/avif) > placeholder
```

After installing, refresh the dev preview, or run `npm run embed && npm run inject`
for the injected Codex build.

## Background image

Supported names, checked in order:

```text
public/assets/background.webp
public/assets/background.png
public/assets/background.jpg
public/assets/background.jpeg
public/assets/background.avif
```

Recommendations:

- 2560×1440 or 3840×2160, 16:9.
- Keep the visual focus away from the exact center if a model will sit there.
- Leave some low-contrast area for text readability; the app also applies `dim`.
- WebP q85–q90 is usually 3–5× smaller than PNG.
- Avoid transparent PNG backgrounds; the shader expects an opaque image.

The image is sampled by a fullscreen shader with cover-fit behavior, so non-16:9 images are cropped rather than stretched.

## Background video

Supported names, checked before any still image:

```text
public/assets/background.mp4
public/assets/background.webm
```

- Muted, looping, inline playback; no controls and no audio autoplay.
- Use H.264 MP4 for compatibility; WebM/VP9 is smaller but slower to decode on some machines.
- 1080p60 or 1440p is plenty. 4K video costs a lot of VRAM when combined with bloom.
- Keep clips under ~60 seconds and loop them with a matching first/last frame to hide the cut.
- The same shader effects (parallax, dim, grain, bloom) apply on top of the video.

Import a Wallpaper Engine video wallpaper:

```bash
npm run wallpaper -- "D:\SteamLibrary\steamapps\workshop\content\431960\<id>"
```

## Scene wallpapers

Scene wallpapers are imported into a normalized directory:

```text
public/assets/wallpaper/
  scene.json              normalized pipeline + source metadata
  scene.jpg               artwork
  mask_shake_*.png        flow maps for shake passes
  mask_foliagesway_*.png  optional foliage mask
```

Import the wallpaper currently selected in Wallpaper Engine, or target it by ID/folder:

```bash
npm run wallpaper -- --current
npm run wallpaper -- 3806385218
npm run wallpaper -- "D:\SteamLibrary\steamapps\workshop\content\431960\3806385218"
```

The importer locates Steam and RePKG automatically. If RePKG is installed somewhere else:

```bash
npm run wallpaper -- --current --repkg "C:\Tools\RePKG\RePKG.exe"
```

If the `.pkg` is already unpacked:

```bash
npm run wallpaper -- --scene "C:\path\to\unpacked-scene"
```

Supported effect ports:

| Effect | Behavior |
| --- | --- |
| `shake` | Flow-map UV offset with Wallpaper Engine timing, friction, bounds, and strength |
| `foliagesway` | MODE 0 UV distortion with phase, power, ratio, direction, and strength |

Other effects are listed during import and skipped; the artwork still loads as a still background. Use `--force` to re-extract and overwrite existing output.

Scene wallpapers are user-supplied third-party artwork. Do not publish imported assets unless the license allows redistribution; `public/assets/*` is ignored by Git.

## Models

Supported names:

```text
public/assets/model.glb
public/assets/model.gltf
```

For `.gltf`, keep the `.bin`, textures, and any `.ktx2` files next to it and update relative URIs if needed. GLB is strongly preferred.

### Tripo export checklist

1. Export **GLB**, not OBJ/FBX, unless you have a specific reason.
2. Include textures in the file; avoid external texture folders.
3. Keep the model under ~15 MB and textures at 2K or below.
4. If the exporter offers Draco or Meshopt compression, it is safe to enable.
5. Remove cameras, lights, and animation tracks you do not need.
6. Apply transforms before export so the bounding box is meaningful.

### Auto-fit behavior

`src/scene/model.js` does the following on load:

```text
Box3.setFromObject(model)
center = box center
scale  = 3.35 / max(box size)
model.position = -center * scale
model.scale    = scale
```

Then a wireframe shell is placed around the model and the whole group is added to a spinner that rotates on Y.

This means:

- absolute model size in the GLB does not matter;
- asymmetric pivots are corrected automatically;
- very thin models may look small because the longest edge drives the scale;
- use the `modelScale`, `modelX`, `modelY` settings to fine-tune.

### Compression support

| Format | Loader | Notes |
| --- | --- | --- |
| Plain GLB / glTF | `GLTFLoader` | baseline |
| Draco | `DRACOLoader` | decoder copied to `public/vendor/draco/` |
| Meshopt | `MeshoptDecoder` | bundled in the IIFE |
| KTX2 / Basis | `KTX2Loader` | decoder copied to `public/vendor/basis/` |

Run `npm run sync:decoders` after `npm install` if `public/vendor/` is missing.

## Performance

| Symptom | Fix |
| --- | --- |
| Low FPS on integrated GPU | `quality: 'low'`, disable particles |
| Stutter when moving the mouse | reduce `parallax`, lower DPR |
| Bloom looks blown out | lower `bloom` to 0.5–0.7 |
| Background too busy behind text | raise `dim`, lower `grain` |
| Model too large / off-center | adjust `modelScale`, `modelX`, `modelY` |

## Licensing

Only commit assets you created or have a license to redistribute. `public/assets/*` is gitignored for this reason; the repository ships with no third-party art or models.

