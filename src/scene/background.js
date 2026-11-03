import * as THREE from 'three';
import { backgroundVertex, backgroundFragment } from '../shaders.js';

export class BackgroundLayer {
  constructor(scene, renderer) {
    this.renderer = renderer;
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
  }

  setTexture(texture, imageAspect) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    this.uniforms.uTex.value = texture;
    this.aspect = imageAspect || 16 / 9;
    this.uniforms.uImageAspect.value = this.aspect;
  }

  resize(camera, width, height) {
    const distance = camera.position.z - this.mesh.position.z;
    const visibleHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * distance;
    const visibleWidth = visibleHeight * (width / height);
    this.mesh.scale.set(visibleWidth * 1.55, visibleHeight * 1.55, 1);
    this.uniforms.uScreenAspect.value = width / height;
  }

  update(time, mouse, config) {
    this.uniforms.uTime.value = time;
    this.uniforms.uMouse.value.lerp(mouse, 0.06);
    this.uniforms.uParallax.value = config.parallax;
    this.uniforms.uDim.value = config.dim;
    this.uniforms.uGrain.value = config.grain;
    this.uniforms.uMotion.value = config.motion;
  }
}
