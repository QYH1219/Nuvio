import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { gradeShader } from './shaders.js';

export class PostFX {
  constructor(renderer, scene, camera, width, height) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.85, 0.72, 0.62);
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.grade = new ShaderPass(gradeShader);
    this.composer.addPass(this.grade);

    this.enabled = true;
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
  }

  setBloom(strength) {
    this.bloom.enabled = strength > 0.01;
    this.bloom.strength = strength;
  }

  update(time, config) {
    this.grade.uniforms.uTime.value = time;
    this.grade.uniforms.uGrain.value = config.grain;
    this.grade.uniforms.uVignette.value = Number.isFinite(config.vignette) ? config.vignette : 0.45;
    this.grade.uniforms.uAberration.value = config.parallax * 0.8;
  }

  render(dt) {
    this.composer.render(dt);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.composer.dispose();
    } catch {
      /* ignore */
    }
    this.bloom?.dispose?.();
    this.grade?.dispose?.();
    this.output?.dispose?.();
  }
}
