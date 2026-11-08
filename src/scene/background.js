import * as THREE from 'three';
import { backgroundVertex, backgroundFragment } from '../shaders.js';
import { createSceneMaterial } from './wallpaper.js';

export class BackgroundLayer {
  constructor(scene, renderer, textureEdges = {}) {
    this.renderer = renderer;
    this.textureEdges = textureEdges;
    this.aspect = 16 / 9;

    this.uniforms = {
      uTex: { value: null },
      uMouse: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uParallax: { value: 1 },
      uDim: { value: 0.2 },
      uGrain: { value: 0.55 },
      uMotion: { value: 1 },
      uScreenAspect: { value: 16 / 9 },
      uImageAspect: { value: 16 / 9 },
      uFitMode: { value: 0 },
    };

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: backgroundVertex,
        fragmentShader: backgroundFragment,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.mesh.position.z = -16;
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.mode = 'image';
    this.imageMaterial = this.mesh.material;
    this.sceneMaterial = null;
  }

  setTexture(texture, imageAspect) {
    this.disposeSceneMaterial();
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    this.uniforms.uTex.value = texture;
    this.aspect = imageAspect || 16 / 9;
    this.uniforms.uImageAspect.value = this.aspect;
  }

  /** Replay a Wallpaper Engine scene effect chain (shake + foliage sway). */
  setSceneWallpaper(data) {
    this.disposeSceneMaterial();
    this.sceneMaterial = createSceneMaterial(data, this.renderer, this.textureEdges);
    this.mesh.material = this.sceneMaterial;
    this.mode = 'scene';
    this.aspect = data.image.width / data.image.height;
    this.resize(this.cameraRef, this.width || 1280, this.height || 720);
  }

  setCameraRef(camera) {
    this.cameraRef = camera;
  }

  /**
   * `auto` keeps whatever the scene author chose; `cover` / `stretch` force a
   * mapping. Live uniform, so switching does not rebuild the material.
   */
  setFit(fit) {
    const mode = String(fit || 'auto').toLowerCase();
    if (mode === 'auto') {
      // Scene wallpapers keep the fit recorded in scene.json; images and
      // videos fall back to cover.
      if (!this.sceneMaterial) this.uniforms.uFitMode.value = 0;
      return;
    }
    // 0 = cover, 1 = stretch, 2 = contain (full artwork + letterbox).
    const value = mode === 'stretch' ? 1 : mode === 'contain' ? 2 : 0;
    this.uniforms.uFitMode.value = value;
    if (!this.sceneMaterial) return;
    const uniform = this.sceneMaterial.uniforms?.uFitMode;
    if (uniform) uniform.value = value;
  }

  resize(camera, width, height) {
    this.cameraRef = camera;
    this.width = width;
    this.height = height;
    const distance = camera.position.z - this.mesh.position.z;
    const visibleHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * distance;
    const visibleWidth = visibleHeight * (width / height);
    this.mesh.scale.set(visibleWidth * 1.55, visibleHeight * 1.55, 1);
    this.uniforms.uScreenAspect.value = width / height;
    if (this.sceneMaterial) {
      this.sceneMaterial.resize(camera, width, height, this.renderer.getPixelRatio());
    }
  }

  update(time, mouse, config) {
    this.uniforms.uTime.value = time;
    this.uniforms.uMouse.value.lerp(mouse, 0.06);
    this.uniforms.uParallax.value = config.parallax;
    this.uniforms.uDim.value = config.dim;
    this.uniforms.uGrain.value = config.grain;
    this.uniforms.uMotion.value = config.motion;
    if (this.sceneMaterial) {
      this.sceneMaterial.update(time, mouse, config);
    }
  }

  disposeSceneMaterial() {
    if (!this.sceneMaterial) return;
    this.mesh.material = this.imageMaterial;
    this.sceneMaterial.disposeTextures();
    this.sceneMaterial.dispose();
    this.sceneMaterial = null;
    this.mode = 'image';
  }

  dispose() {
    this.disposeSceneMaterial();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
