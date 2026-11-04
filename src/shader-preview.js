import * as THREE from 'three';
import { SceneWallpaperMaterial } from './scene/wallpaper.js';

const BASE = '/__shader-preview__/';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load ${url}`));
    image.src = url;
  });
}

async function main() {
  const canvas = document.getElementById('view');
  const missing = () => {
    const note = document.createElement('pre');
    note.style.cssText =
      'position:fixed;inset:0;display:grid;place-items:center;margin:0;color:#9fb3c8;' +
      'background:#05080a;font:14px/1.6 ui-monospace,Consolas,monospace;text-align:center;' +
      'white-space:pre-wrap;padding:32px;';
    note.textContent =
      'Shader preview needs a local scene fixture.\n\n' +
      'Export one with:\n' +
      '  node tools/wallpaper.mjs --scene <dir> --dry-run\n\n' +
      'then copy its artwork/textures into public/__shader-preview__/ and\n' +
      'write scene.json with { image, pipeline: [{ type, textures, params }] }.';
    document.body.appendChild(note);
  };

  let sceneData;
  try {
    const response = await fetch(`${BASE}scene.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    sceneData = await response.json();
  } catch {
    missing();
    window.__PREVIEW_READY__ = false;
    return;
  }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const image = await loadImage(BASE + sceneData.image);

  const cache = new Map();
  const images = new Map();
  for (const entry of sceneData.pipeline || []) {
    for (const key of ['mask', 'normal', 'phase']) {
      const file = entry.textures?.[key] || (key === 'mask' ? entry.mask : null);
      if (!file) continue;
      if (!cache.has(file)) cache.set(file, loadImage(BASE + file));
      images.set(entry, { ...(images.get(entry) || {}), [key]: await cache.get(file) });
    }
  }

  const pipeline = (sceneData.pipeline || []).map((entry) => ({
    ...entry,
    images: images.get(entry) || {},
  }));

  const material = new SceneWallpaperMaterial(
    { image, pipeline, fit: 'cover' },
    renderer,
  );
  material.resize(null, window.innerWidth, window.innerHeight, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(quad);

  const config = {
    parallax: 0,
    dim: 0,
    sceneShake: 1,
    sceneSway: 1,
    sceneWater: 1,
  };
  const mouse = new THREE.Vector2();
  const clock = new THREE.Clock();
  const fixedTime = Number(new URLSearchParams(location.search).get('t'));
  const frozen = Number.isFinite(fixedTime);
  let frames = 0;

  renderer.setAnimationLoop(() => {
    material.update(frozen ? fixedTime : clock.getElapsedTime(), mouse, config);
    renderer.render(scene, camera);
    frames += 1;
    if (frames === 2) {
      window.__PREVIEW_READY__ = true;
      window.__PREVIEW_TYPES__ = material.effectTypes;
    }
  });
}

main().catch((error) => {
  window.__PREVIEW_ERROR__ = String(error?.stack || error);
  document.body.dataset.error = '1';
  console.error(error);
});
