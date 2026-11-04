import * as THREE from 'three';
import { sceneVertex, buildSceneShader } from '../shaders.js';

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pair(value, fallback) {
  if (Array.isArray(value) && value.length >= 2) {
    return [num(value[0], fallback[0]), num(value[1], fallback[1])];
  }
  if (typeof value === 'string') {
    const parts = value.trim().split(/\s+/).map(Number);
    if (parts.length >= 2 && parts.every(Number.isFinite)) return [parts[0], parts[1]];
  }
  return fallback;
}

function makeTexture(image, srgb, renderer, repeat = false) {
  const texture = new THREE.Texture(image);
  // Wallpaper Engine UVs have a top-left origin. Disable the upload flip and
  // flip the coordinate in the shader so masks and the artwork stay aligned.
  texture.flipY = false;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  const wrap = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  return texture;
}

/** Neutral flow map: RG 0.498 encodes a zero direction vector. */
function neutralFlowMap() {
  const texture = new THREE.DataTexture(
    new Uint8Array([127, 127, 127, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** 1x1 white mask for effects whose mask pass is absent. */
function whiteMask() {
  const texture = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

const MAX_TEXTURES = 16; // WebGL2 guarantees at least 16 fragment units.
const SUPPORTED = new Set(['shake', 'foliagesway', 'waterwaves', 'waterripple', 'waterflow']);

/**
 * One ShaderMaterial that replays a Wallpaper Engine scene effect chain.
 *
 * The shader is generated from the imported pipeline, so a scene with two
 * shakes renders two shakes and a scene with water waves/ripples/flow compiles
 * only those passes. Texture slots are deduplicated and capped for WebGL2.
 */
export class SceneWallpaperMaterial extends THREE.ShaderMaterial {
  constructor(data, renderer) {
    const pipeline = Array.isArray(data.pipeline) ? data.pipeline : [];
    const image = data.image;
    if (!image) throw new Error('scene wallpaper: missing image');

    const uniforms = {
      uTex: { value: makeTexture(image, true, renderer) },
      uTime: { value: 0 },
      uParallax: { value: 1 },
      uDim: { value: 0.2 },
      uScreenAspect: { value: 16 / 9 },
      uImageAspect: { value: image.width / image.height },
      uFitMode: { value: String(data.fit || 'cover').toLowerCase() === 'stretch' ? 1 : 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uMouse: { value: new THREE.Vector2() },
      uShakeAmount: { value: 1 },
      uSwayAmount: { value: 1 },
      uWaterAmount: { value: 1 },
    };

    const created = [uniforms.uTex.value];
    const byImage = new WeakMap();

    const textureFor = (source, options = {}) => {
      if (!source) return null;
      const { srgb = false, repeat = false } = options;
      let modes = byImage.get(source);
      if (!modes) {
        modes = new Map();
        byImage.set(source, modes);
      }
      const key = `${srgb ? 'srgb' : 'linear'}:${repeat ? 'repeat' : 'clamp'}`;
      if (modes.has(key)) return modes.get(key);
      if (created.length >= MAX_TEXTURES) {
        console.warn('[codex-bg] scene texture budget reached, dropping effect');
        return null;
      }
      const texture = makeTexture(source, srgb, renderer, repeat);
      modes.set(key, texture);
      created.push(texture);
      return texture;
    };

    const stages = [];
    let effectIndex = 0;

    for (const entry of pipeline) {
      if (!entry || !SUPPORTED.has(entry.type)) continue;
      const prefix = `e${effectIndex}`;
      const params = entry.params || {};
      const images = entry.images || {};
      const mask = images.mask || null;
      const normal = images.normal || null;
      const phase = images.phase || null;
      // Wallpaper Engine effect masks are authored in the scene render-target
      // space, not in artwork pixels. Masks are 1920x1080 next to 3840x2160
      // artwork, so scaling by mask.width / image.width would sample only the
      // top-left quarter of every mask. UV space is shared: scale stays 1.
      const maskScale = 1;

      if (entry.type === 'waterripple' && !normal) {
        console.warn('[codex-bg] waterripple needs a normal map, skipping');
        continue;
      }
      if (entry.type === 'waterflow' && (!mask || !phase)) {
        console.warn('[codex-bg] waterflow needs a flow mask and phase map, skipping');
        continue;
      }

      const maskTexture =
        entry.type === 'shake' && !mask
          ? neutralFlowMap()
          : entry.type === 'waterripple' && !mask
            ? whiteMask()
            : textureFor(mask);
      if (maskTexture && !created.includes(maskTexture)) created.push(maskTexture);

      const stage = {
        type: entry.type,
        prefix,
        hasMask: Boolean(maskTexture),
        hasNormal: Boolean(normal),
        hasPhase: Boolean(phase),
        maskScale,
      };

      switch (entry.type) {
        case 'shake': {
          if (!maskTexture) continue;
          uniforms[`${prefix}Mask`] = { value: maskTexture };
          uniforms[`${prefix}MaskScale`] = { value: maskScale };
          uniforms[`${prefix}Speed`] = { value: num(params.speed, 1) };
          uniforms[`${prefix}Strength`] = { value: num(params.strength, 0.1) };
          uniforms[`${prefix}Friction`] = {
            value: new THREE.Vector2(...pair(params.friction, [1, 1])),
          };
          uniforms[`${prefix}Bounds`] = {
            value: new THREE.Vector2(...pair(params.bounds, [0, 1])),
          };
          break;
        }
        case 'foliagesway': {
          if (maskTexture) {
            uniforms[`${prefix}Mask`] = { value: maskTexture };
            uniforms[`${prefix}MaskScale`] = { value: maskScale };
          }
          uniforms[`${prefix}Speed`] = { value: num(params.speed, 5) };
          uniforms[`${prefix}Strength`] = { value: num(params.strength, 0.4) };
          uniforms[`${prefix}Phase`] = { value: num(params.phase, 0.5) };
          uniforms[`${prefix}Power`] = { value: num(params.power, 1.11) };
          uniforms[`${prefix}Ratio`] = { value: num(params.ratio, 3.5) };
          uniforms[`${prefix}Scale`] = { value: num(params.scale, 0.05) };
          uniforms[`${prefix}Direction`] = { value: num(params.direction, 0) };
          break;
        }
        case 'waterwaves': {
          if (maskTexture) {
            uniforms[`${prefix}Mask`] = { value: maskTexture };
            uniforms[`${prefix}MaskScale`] = { value: maskScale };
          }
          uniforms[`${prefix}Direction`] = { value: num(params.direction, 0) };
          uniforms[`${prefix}Scale`] = { value: num(params.scale, 200) };
          uniforms[`${prefix}Speed`] = { value: num(params.speed, 5) };
          uniforms[`${prefix}Strength`] = { value: num(params.strength, 0.1) };
          uniforms[`${prefix}Perspective`] = { value: num(params.perspective, 0) };
          break;
        }
        case 'waterripple': {
          const normalTexture = textureFor(normal, { repeat: true });
          if (!normalTexture) continue;
          uniforms[`${prefix}Mask`] = { value: maskTexture };
          uniforms[`${prefix}Normal`] = { value: normalTexture };
          uniforms[`${prefix}MaskScale`] = { value: maskScale };
          uniforms[`${prefix}AnimSpeed`] = { value: num(params.animationspeed, 0.15) };
          uniforms[`${prefix}Scale`] = { value: num(params.scale, 1) };
          uniforms[`${prefix}ScrollSpeed`] = { value: num(params.scrollspeed, 0) };
          uniforms[`${prefix}Direction`] = { value: num(params.direction, 0) };
          uniforms[`${prefix}Ratio`] = { value: num(params.ratio, 1) };
          uniforms[`${prefix}Strength`] = { value: num(params.strength, 0.1) };
          break;
        }
        case 'waterflow': {
          const phaseTexture = textureFor(phase, { repeat: true });
          if (!phaseTexture || !maskTexture) continue;
          uniforms[`${prefix}Mask`] = { value: maskTexture };
          uniforms[`${prefix}Phase`] = { value: phaseTexture };
          uniforms[`${prefix}MaskScale`] = { value: maskScale };
          uniforms[`${prefix}Speed`] = { value: num(params.speed, 1) };
          uniforms[`${prefix}Strength`] = { value: num(params.strength, 1) };
          uniforms[`${prefix}PhaseScale`] = { value: num(params.phasescale, 2) };
          break;
        }
        default:
          continue;
      }

      stages.push(stage);
      effectIndex += 1;
    }

    super({
      uniforms,
      vertexShader: sceneVertex,
      fragmentShader: buildSceneShader(stages),
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });

    this.textures = created;
    this.imageAspect = image.width / image.height;
    this.effectTypes = stages.map((stage) => stage.type);
  }

  resize(_camera, width, height, _pixelRatio) {
    this.uniforms.uScreenAspect.value = width / height;
    // `gl_FragCoord` reaches this shader in CSS viewport units in the Codex
    // Electron surface (the drawing buffer is larger at a 1.5 DPR). Using the
    // CSS size keeps the full artwork mapped to the full window; multiplying
    // by DPR only sampled the top-left ~2/3 of the texture.
    this.uniforms.uResolution.value.set(width, height);
  }

  update(time, mouse, config) {
    this.uniforms.uTime.value = time;
    this.uniforms.uMouse.value.copy(mouse);
    this.uniforms.uParallax.value = config.parallax;
    this.uniforms.uDim.value = config.dim;
    this.uniforms.uShakeAmount.value = Number.isFinite(config.sceneShake) ? config.sceneShake : 1;
    this.uniforms.uSwayAmount.value = Number.isFinite(config.sceneSway) ? config.sceneSway : 1;
    this.uniforms.uWaterAmount.value = Number.isFinite(config.sceneWater) ? config.sceneWater : 1;
  }

  disposeTextures() {
    this.textures.forEach((texture) => texture.dispose());
    this.textures = [];
  }
}
