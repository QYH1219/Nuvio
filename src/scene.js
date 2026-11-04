import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BackgroundLayer } from './scene/background.js';
import { ModelLayer } from './scene/model.js';
import { Particles } from './scene/particles.js';
import { PostFX } from './post.js';
import { QUALITY, clamp } from './config.js';

export class BackgroundEngine {
  constructor(container, config) {
    this.container = container;
    this.config = { ...config };
    this.time = 0;
    this.mouse = new THREE.Vector2();
    this.targetMouse = new THREE.Vector2();
    this.visible = true;
    this.running = false;
    this.fps = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._last = performance.now();

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cxd-canvas';
    container.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(0x030509, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 120);
    this.camera.position.set(0, 0, 10);

    this.setupEnvironment();
    this.setupLights();

    this.background = new BackgroundLayer(this.scene, this.renderer);
    this.glow = this.createGlow();
    this.model = new ModelLayer(this.scene, this.renderer);
    this.particles = new Particles(this.scene);

    this.post = new PostFX(
      this.renderer,
      this.scene,
      this.camera,
      container.clientWidth || 1280,
      container.clientHeight || 720,
    );

    this.quality = QUALITY[this.config.quality] || QUALITY.high;
    this.applyQuality();

    this._onPointerMove = this.onPointerMove.bind(this);
    this._onVisibility = () => {
      this.visible = !document.hidden;
    };
    window.addEventListener('pointermove', this._onPointerMove, { passive: true });
    document.addEventListener('visibilitychange', this._onVisibility);

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(container);
    this.resize();
  }

  setupEnvironment() {
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    const envScene = new RoomEnvironment();
    this.envRT = this.pmrem.fromScene(envScene, 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.55;
  }

  setupLights() {
    const ambient = new THREE.AmbientLight(0x88aabb, 0.5);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffe1bd, 2.2);
    key.position.set(5, 7, 6);
    this.scene.add(key);

    const rimA = new THREE.PointLight(0x3fe0d4, 120, 34, 2);
    rimA.position.set(-6, 2.5, 4);
    this.scene.add(rimA);

    const rimB = new THREE.PointLight(0x8b6bff, 90, 34, 2);
    rimB.position.set(6, -2.5, 3);
    this.scene.add(rimB);

    this.lights = { key, rimA, rimB };
  }

  createGlow() {
    const uniforms = {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color('#1b6f78') },
      uColorB: { value: new THREE.Color('#4b3f9e') },
      uStrength: { value: 1.0 },
    };
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(15, 15),
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform float uTime;
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          uniform float uStrength;
          varying vec2 vUv;
          void main() {
            vec2 p = vUv - 0.5;
            float d = length(p) * 2.0;
            float core = smoothstep(0.55, 0.0, d);
            float halo = smoothstep(1.05, 0.15, d);
            float ripple = 0.88 + 0.12 * sin(uTime * 0.6 + d * 6.0);
            vec3 col = mix(uColorA, uColorB, smoothstep(0.1, 0.9, d));
            float a = (core * 0.5 + halo * 0.32) * ripple * uStrength;
            gl_FragColor = vec4(col * a, a);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    mesh.position.set(0, 0, -5.5);
    mesh.renderOrder = -50;
    this.scene.add(mesh);
    return mesh;
  }

  async setBackgroundImage(img) {
    this.disposeBackgroundTexture();
    const texture = new THREE.Texture(img);
    texture.needsUpdate = true;
    this.background.setTexture(texture, img.width / img.height);
    this.backgroundTexture = texture;
    this.backgroundVideo = null;
  }

  async setBackgroundVideo(video) {
    this.disposeBackgroundTexture();
    const texture = new THREE.VideoTexture(video);
    texture.needsUpdate = true;
    this.background.setTexture(texture, video.videoWidth / video.videoHeight);
    this.backgroundTexture = texture;
    this.backgroundVideo = video;
  }

  disposeBackgroundTexture() {
    if (this.backgroundVideo) {
      try {
        this.backgroundVideo.pause();
        this.backgroundVideo.removeAttribute('src');
        this.backgroundVideo.load();
      } catch {
        /* ignore */
      }
      this.backgroundVideo = null;
    }
    if (this.backgroundTexture) {
      this.backgroundTexture.dispose();
      this.backgroundTexture = null;
    }
  }

  async loadModel(url, onProgress) {
    await this.model.load(url, onProgress);
  }

  onPointerMove(event) {
    const rect = this.container.getBoundingClientRect();
    this.targetMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.targetMouse.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
  }

  setConfig(config) {
    const qualityChanged = config.quality !== this.config.quality;
    const densityChanged = config.quality !== this.config.quality;
    this.config = { ...config };
    if (qualityChanged) {
      this.quality = QUALITY[config.quality] || QUALITY.high;
      this.applyQuality();
    }
    if (densityChanged) this.particles.setDensity(this.quality.particleScale);
    this.post.setBloom(config.bloom * (this.quality.bloom ? 1 : 0));
    this.glow.material.uniforms.uStrength.value = 0.55 + config.bloom * 0.55;
    this.glow.position.x = config.modelX * 2.2;
  }

  applyQuality() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.dpr);
    this.renderer.setPixelRatio(dpr);
    this.pixelRatio = dpr;
    this.particles.setDensity(this.quality.particleScale);
    this.post.setBloom(this.config.bloom * (this.quality.bloom ? 1 : 0));
    this.resize();
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.post.setSize(width, height);
    this.background.resize(this.camera, width, height);
    this.width = width;
    this.height = height;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      this.frame();
    };
    this._raf = requestAnimationFrame(loop);
  }

  frame() {
    const now = performance.now();
    const rawDt = (now - this._last) / 1000;
    this._last = now;
    const dt = clamp(rawDt, 0.001, 0.05);

    if (!this.visible) return;

    this.time += dt * Math.max(0.05, this.config.motion);
    this.mouse.lerp(this.targetMouse, 0.055);

    this.camera.position.x = this.mouse.x * 0.28 * this.config.parallax;
    this.camera.position.y = -this.mouse.y * 0.18 * this.config.parallax;
    this.camera.lookAt(0, 0, 0);

    this.background.update(this.time, this.mouse, this.config);
    this.model.update(dt, this.time, this.mouse, this.config);
    this.particles.update(this.time, this.pixelRatio, this.config);

    this.glow.material.uniforms.uTime.value = this.time;
    this.glow.position.y = this.config.modelY * 1.4;

    this.lights.rimA.position.x = -6 + Math.sin(this.time * 0.35) * 1.2;
    this.lights.rimB.position.x = 6 + Math.cos(this.time * 0.28) * 1.2;

    this.post.update(this.time, this.config);
    this.post.render(dt);

    this._fpsAcc += rawDt;
    this._fpsFrames += 1;
    if (this._fpsAcc >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
      this.onFps && this.onFps(this.fps);
    }
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this._resizeObserver.disconnect();
    this.disposeBackgroundTexture();
    this.renderer.dispose();
    this.envRT.dispose();
    this.pmrem.dispose();
  }
}
