import * as THREE from 'three';
import { sceneVertex, sceneFragment } from '../shaders.js';

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

function makeTexture(image, srgb, renderer) {
  const texture = new THREE.Texture(image);
  // Wallpaper Engine UVs have a top-left origin. Disable the upload flip and
  // flip the coordinate in the shader so masks and the artwork stay aligned.
  texture.flipY = false;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  return texture;
}

/** Neutral flow map: RG 0.498 encodes a zero direction vector. */
function neutralFlowMap() {
  const texture = new THREE.DataTexture(new Uint8Array([127, 127, 127, 255]), 1, 1, THREE.RGBAFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * One ShaderMaterial that replays a Wallpaper Engine scene effect chain:
 * up to three `shake` flow-map passes plus one `foliagesway` UV pass.
 */
export class SceneWallpaperMaterial extends THREE.ShaderMaterial {
  constructor(data, renderer) {
    const pipeline = Array.isArray(data.pipeline) ? data.pipeline : [];
    const shakes = pipeline.filter((entry) => entry && entry.type === 'shake').slice(0, 3);
    const sway = pipeline.find((entry) => entry && entry.type === 'foliagesway') || null;
    const shakeParams = (shakes[0] && shakes[0].params) || {};
    const swayParams = (sway && sway.params) || {};

    const image = data.image;
    if (!image) throw new Error('scene wallpaper: missing image');

    const mainTexture = makeTexture(image, true, renderer);
    const maskTextures = shakes.map((entry) =>
      entry.image ? makeTexture(entry.image, false, renderer) : neutralFlowMap(),
    );
    while (maskTextures.length < 3) maskTextures.push(neutralFlowMap());

    const imageAspect = image.width / image.height;
    const firstMask = shakes.find((entry) => entry.image);
    const maskScale = firstMask
      ? firstMask.image.width / image.width
      : 1;

    const uniforms = {
      uTex: { value: mainTexture },
      uShake0: { value: maskTextures[0] },
      uShake1: { value: maskTextures[1] },
      uShake2: { value: maskTextures[2] },
      uTime: { value: 0 },
      uParallax: { value: 1 },
      uDim: { value: 0.2 },
      uScreenAspect: { value: 16 / 9 },
      uImageAspect: { value: imageAspect },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uMouse: { value: new THREE.Vector2() },
      uShakeAmount: { value: 1 },
      uSwayAmount: { value: 1 },
      uMaskScale: { value: maskScale },
      uShakeSpeed: { value: num(shakeParams.speed, 1) },
      uShakeStrength: { value: num(shakeParams.strength, 0.1) },
      uShakeFriction: { value: new THREE.Vector2(...pair(shakeParams.friction, [1, 1])) },
      uShakeBounds: { value: new THREE.Vector2(...pair(shakeParams.bounds, [0, 1])) },
      uSwaySpeed: { value: num(swayParams.speed, 5) },
      uSwayStrength: { value: num(swayParams.strength, 0.4) },
      uSwayPhase: { value: num(swayParams.phase, 0.5) },
      uSwayPower: { value: num(swayParams.power, 1.11) },
      uSwayRatio: { value: num(swayParams.ratio, 3.5) },
      uSwayScale: { value: num(swayParams.scale, 0.05) },
      uSwayDirection: { value: num(swayParams.direction, 0) },
    };

    super({
      uniforms,
      vertexShader: sceneVertex,
      fragmentShader: sceneFragment,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });

    this.textures = [mainTexture, ...maskTextures];
    this.imageAspect = imageAspect;
  }

  resize(_camera, width, height, pixelRatio) {
    this.uniforms.uScreenAspect.value = width / height;
    this.uniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio);
  }

  update(time, mouse, config) {
    this.uniforms.uTime.value = time;
    this.uniforms.uMouse.value.copy(mouse);
    this.uniforms.uParallax.value = config.parallax;
    this.uniforms.uDim.value = config.dim;
    this.uniforms.uShakeAmount.value = Number.isFinite(config.sceneShake) ? config.sceneShake : 1;
    this.uniforms.uSwayAmount.value = Number.isFinite(config.sceneSway) ? config.sceneSway : 1;
  }

  disposeTextures() {
    this.textures.forEach((texture) => texture.dispose());
    this.textures = [];
  }
}
