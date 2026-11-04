import * as THREE from 'three';
import { particleVertex, particleFragment } from '../shaders.js';

export class Particles {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.points = null;
    this.count = 0;
    this.build(900);
  }

  build(count) {
    if (this.points) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
    }

    this.count = count;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const scales = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 19;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 15;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 12;
      seeds[i] = Math.random();
      scales[i] = 0.45 + Math.random() * 1.6;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMotion: { value: 1 },
        uSize: { value: 1.35 },
        uPixelRatio: { value: 1 },
        uColorA: { value: new THREE.Color('#71f0e2') },
        uColorB: { value: new THREE.Color('#9d8cff') },
      },
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  setDensity(scale) {
    const next = Math.round(900 * scale);
    if (Math.abs(next - this.count) > 40) this.build(next);
  }

  update(time, pixelRatio, config) {
    if (!this.points) return;
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uMotion.value = config.motion;
    this.material.uniforms.uPixelRatio.value = pixelRatio;
    this.group.visible = config.particles;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.points) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
      this.material = null;
    }
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
