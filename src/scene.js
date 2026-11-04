import * as THREE from 'three';
import { BackgroundLayer } from './scene/background.js';
import { QUALITY, clamp, normalizeQuality } from './config.js';
import { describeGpu, detectLowEndGpu, readGpuString, resolveFpsCap } from './gpu.js';
import { getTheme } from './presets.js';
import {
  ARTWORK_TEXTURE_EDGE,
  makeImageTexture,
  summarizeTextures,
} from './texture.js';

const IDLE_PAUSE_MS = 1400;

/**
 * WebGL background engine.
 *
 * Two modes share one renderer:
 *
 *   procedural — the generated look: environment map, lights, glow, particles,
 *                optional GLB model, post-processing.
 *   artwork    — a photo / video / Wallpaper Engine scene owns the frame. No
 *                environment map, no lights, no particles, no composer: a
 *                single fullscreen quad and one `renderer.render()`.
 *
 * Heavy modules (GLTFLoader, postprocessing, RoomEnvironment) are imported
 * dynamically so a wallpaper-only session never pays for them.
 */
export class BackgroundEngine {
  constructor(container, config) {
    this.container = container;
    this.config = { ...config };
    this.time = 0;
    this.mouse = new THREE.Vector2();
    this.targetMouse = new THREE.Vector2();
    this.visible = !document.hidden;
    this.fps = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._last = 0;
    this._lastRender = 0;
    this._lastPointer = -1e9;
    this._raf = 0;
    this._timer = 0;
    this._running = false;
    this._needsRepaint = true;
    this.mode = 'procedural';
    this.artworkKind = 'none';
    this.modelEnabled = true;
    this.disposed = false;
    this.webFrame = null;
    this.contextLost = false;
    this.focused = typeof document === 'undefined' ? true : document.hasFocus();

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cxd-canvas';
    container.appendChild(this.canvas);

    this.quality = QUALITY[normalizeQuality(this.config.quality)];
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      // A fullscreen background quad has no geometric edges to smooth. MSAA
      // cannot be toggled after context creation either, so leaving it off
      // keeps every tier on the exact same shader/compositing path.
      antialias: false,
      alpha: false,
      powerPreference: 'default',
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(0x030509, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    // The adapter name decides whether the tier frame cap is lowered to 24.
    // Sampling, fit and composition stay untouched, so a low-end machine sees
    // the same wallpaper, just at a calmer frame rate.
    const gpuRaw = readGpuString(this.renderer);
    this.gpu = describeGpu(gpuRaw);
    this.gpuLowEnd = detectLowEndGpu(gpuRaw);
    this.fpsCap = resolveFpsCap({
      tierFps: this.quality.fps,
      lowEnd: this.gpuLowEnd,
      lowEndAuto: this.config.lowEndAuto !== false,
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 120);
    this.camera.position.set(0, 0, 10);

    this.background = new BackgroundLayer(this.scene, this.renderer);

    // Lazily created.
    this.glow = null;
    this.model = null;
    this.particles = null;
    this.post = null;
    this.lights = null;
    this.envRT = null;
    this.pmrem = null;
    this._proceduralReady = null;

    this.applyQuality();

    this._onPointerMove = this.onPointerMove.bind(this);
    this._onVisibility = () => {
      const hidden = document.hidden;
      this.visible = !hidden;
      if (hidden) {
        this._cancel();
      } else {
        this._last = 0;
        this._lastRender = 0;
        this._needsRepaint = true;
        this.wake();
      }
    };
    this._onBlur = () => {
      this.focused = false;
      if (this.config.pauseWhenUnfocused) this._cancel();
    };
    this._onFocus = () => {
      this.focused = true;
      this._last = 0;
      this._lastRender = 0;
      this._needsRepaint = true;
      this.wake();
    };
    this._onContextLost = (event) => {
      // Three.js already prevents the default so the context can be restored.
      // Only stop our frame loop and remember the state.
      this.contextLost = true;
      this._cancel();
      console.warn('[codex-bg] WebGL context lost');
    };
    this._onContextRestored = () => {
      this.contextLost = false;
      const mark = (texture) => {
        if (texture && typeof texture === 'object') texture.needsUpdate = true;
      };
      mark(this.backgroundTexture);
      this.scene.traverse((object) => {
        const uniforms = object.material?.uniforms;
        if (!uniforms) return;
        Object.values(uniforms).forEach((uniform) => mark(uniform?.value));
      });
      this._last = 0;
      this._lastRender = 0;
      this.resize();
      this._needsRepaint = true;
      this.wake();
      console.warn('[codex-bg] WebGL context restored');
    };
    window.addEventListener('pointermove', this._onPointerMove, { passive: true });
    document.addEventListener('visibilitychange', this._onVisibility);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('focus', this._onFocus);
    this.canvas.addEventListener('webglcontextlost', this._onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(container);
    this.resize();
  }

  /* ---------------------------------------------------------------- */
  /* Lazy layers                                                      */
  /* ---------------------------------------------------------------- */

  ensureProcedural() {
    if (this.mode === 'artwork') return Promise.resolve();
    if (this._proceduralReady) return this._proceduralReady;
    this._proceduralReady = (async () => {
      await this.ensureEnvironment();
      this.ensureLights();
      this.ensureGlow();
      await Promise.all([this.ensureParticles(), this.ensurePost()]);
      this.applyQuality();
      this._needsRepaint = true;
      this.wake();
    })().catch((error) => {
      console.warn('[codex-bg] procedural layers unavailable', error);
    });
    return this._proceduralReady;
  }

  async ensureEnvironment() {
    if (this.envRT || this.mode === 'artwork') return;
    const [{ RoomEnvironment }] = await Promise.all([
      import('three/addons/environments/RoomEnvironment.js'),
    ]);
    if (this.disposed || this.mode === 'artwork') return;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    const envScene = new RoomEnvironment();
    this.envRT = this.pmrem.fromScene(envScene, 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.55;
    envScene.dispose?.();
  }

  releaseEnvironment() {
    this.scene.environment = null;
    try {
      this.envRT?.dispose?.();
      this.pmrem?.dispose?.();
    } catch {
      /* ignore */
    }
    this.envRT = null;
    this.pmrem = null;
  }

  ensureLights() {
    if (this.lights) return this.lights;
    const ambient = new THREE.AmbientLight(0x88aabb, 0.5);
    const key = new THREE.DirectionalLight(0xffe1bd, 2.2);
    key.position.set(5, 7, 6);
    const rimA = new THREE.PointLight(0x3fe0d4, 120, 34, 2);
    rimA.position.set(-6, 2.5, 4);
    const rimB = new THREE.PointLight(0x8b6bff, 90, 34, 2);
    rimB.position.set(6, -2.5, 3);
    this.scene.add(ambient, key, rimA, rimB);
    this.lights = { ambient, key, rimA, rimB };
    return this.lights;
  }

  ensureGlow() {
    if (this.glow) return this.glow;
    this.glow = this.createGlow();
    this.glow.visible = this.mode !== 'artwork' && this.modelEnabled;
    return this.glow;
  }

  async ensureParticles() {
    if (this.particles) return this.particles;
    if (this.mode === 'artwork' || this.config.particles === false) return null;
    const { Particles } = await import('./scene/particles.js');
    if (this.disposed || this.mode === 'artwork' || this.config.particles === false) return null;
    this.particles = new Particles(this.scene);
    this.particles.setDensity(1);
    this.applyTheme(this.config.theme);
    return this.particles;
  }

  async ensurePost() {
    if (this.post) return this.post;
    if (this.mode === 'artwork' || !(Number(this.config.bloom) > 0.005)) return null;
    const { PostFX } = await import('./post.js');
    if (this.disposed || this.mode === 'artwork' || !(Number(this.config.bloom) > 0.005)) return null;
    this.post = new PostFX(
      this.renderer,
      this.scene,
      this.camera,
      this.container.clientWidth || 1280,
      this.container.clientHeight || 720,
    );
    this.post.setBloom(this.config.bloom);
    this.post.setSize(this.width || 1280, this.height || 720);
    return this.post;
  }

  async ensureModel() {
    if (this.model) return this.model;
    const { ModelLayer } = await import('./scene/model.js');
    if (this.disposed) return null;
    this.model = new ModelLayer(this.scene, this.renderer);
    if (this.model.root) this.model.root.visible = this.modelEnabled;
    return this.model;
  }

  /* ---------------------------------------------------------------- */
  /* Procedural look                                                  */
  /* ---------------------------------------------------------------- */

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

  /* ---------------------------------------------------------------- */
  /* Background sources                                               */
  /* ---------------------------------------------------------------- */

  async setBackgroundImage(img) {
    this.disposeBackgroundTexture();
    const { texture } = makeImageTexture(img, {
      renderer: this.renderer,
      srgb: true,
      flipY: true,
      maxEdge: ARTWORK_TEXTURE_EDGE,
    });
    this.background.setTexture(texture, img.width / img.height);
    this.backgroundTexture = texture;
    this.backgroundVideo = null;
    this.artworkKind = 'image';
    this._needsRepaint = true;
    this.wake();
  }

  async setBackgroundVideo(video) {
    this.disposeBackgroundTexture();
    const texture = new THREE.VideoTexture(video);
    texture.needsUpdate = true;
    this.background.setTexture(texture, video.videoWidth / video.videoHeight);
    this.backgroundTexture = texture;
    this.backgroundVideo = video;
    this.artworkKind = 'video';
    this._needsRepaint = true;
    this.wake();
  }

  /** Replay a Wallpaper Engine scene wallpaper (effect chain + parallax). */
  setSceneWallpaper(data) {
    this.disposeBackgroundTexture();
    this.background.setSceneWallpaper(data);
    this.background.setFit(this.config.fit);
    this.artworkKind = 'scene';
    this._needsRepaint = true;
    this.wake();
  }

  /**
   * Wallpaper Engine `web` projects are self-contained HTML pages. Rendering
   * them inside an iframe keeps their CSS/JS fully isolated from Codex, and
   * pointer-events:none makes the page inert so it never steals clicks.
   */
  setBackgroundWeb(url) {
    this.disposeBackgroundTexture();
    const frame = document.createElement('iframe');
    frame.className = 'cxd-web-frame';
    frame.title = 'Nuvio web wallpaper';
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.setAttribute('allowtransparency', 'true');
    frame.style.cssText = [
      'position:absolute',
      'inset:0',
      'width:100%',
      'height:100%',
      'border:0',
      'margin:0',
      'padding:0',
      'pointer-events:none',
      'background:transparent',
      'z-index:1',
    ].join(';');
    frame.src = url;
    this.container.appendChild(frame);
    this.webFrame = frame;
    // The WebGL canvas would paint over the iframe; hide it while web mode is
    // active. It is restored by disposeBackgroundTexture().
    this.canvas.style.visibility = 'hidden';
    this.artworkKind = 'web';
    this._needsRepaint = true;
  }

  setFit(fit) {
    this.config.fit = fit;
    this.background.setFit(fit);
    this._needsRepaint = true;
    this.wake();
  }

  disposeBackgroundTexture() {
    if (this.webFrame) {
      try {
        this.webFrame.removeAttribute('src');
        this.webFrame.remove();
      } catch {
        /* ignore */
      }
      this.webFrame = null;
      this.canvas.style.visibility = '';
    }
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
    if (this.background.mode === 'scene') {
      this.background.disposeSceneMaterial();
    }
    this.artworkKind = 'none';
  }

  /* ---------------------------------------------------------------- */
  /* Mode switching                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Artwork mode tears the generated layers down instead of just hiding them:
   * a 2048px PMREM cubemap plus a bloom chain is the difference between a
   * smooth Codex and a stuttering one on integrated graphics.
   */
  setArtworkMode(enabled) {
    const next = Boolean(enabled);
    if (this._artworkKnown && next === (this.mode === 'artwork')) return;
    this._artworkKnown = true;
    this.mode = next ? 'artwork' : 'procedural';

    if (next) {
      this.releaseEnvironment();
      if (this.post) {
        try {
          this.post.dispose();
        } catch {
          /* ignore */
        }
        this.post = null;
      }
      this.particles?.setDensity(0);
      if (this.model?.root) this.model.root.visible = false;
      if (this.glow) this.glow.visible = false;
      this.scene.background = null;
    } else {
      if (this.glow) this.glow.visible = this.modelEnabled;
      this.ensureProcedural();
    }
    this._needsRepaint = true;
    this.wake();
  }

  async loadModel(url, onProgress) {
    const model = await this.ensureModel();
    if (!model) throw new Error('engine disposed');
    await model.load(url, onProgress);
    this.modelEnabled = true;
    if (model.root) model.root.visible = true;
    this.wake();
  }

  clearModel() {
    this.model?.clear?.();
    this.wake();
  }

  /**
   * A photo/video/scene wallpaper owns the frame. Hide the procedural crystal
   * (and its glow) so it does not sit on top of the artwork. Loading an
   * explicit GLB shows the model again.
   */
  setModelEnabled(enabled) {
    this.modelEnabled = Boolean(enabled);
    if (this.model?.root) this.model.root.visible = this.modelEnabled;
    if (this.glow) this.glow.visible = this.modelEnabled && this.mode !== 'artwork';
    this.wake();
  }

  /* ---------------------------------------------------------------- */
  /* Config                                                           */
  /* ---------------------------------------------------------------- */

  onPointerMove(event) {
    const rect = this.container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.targetMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.targetMouse.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    this._lastPointer = performance.now();
    this.wake();
  }

  setConfig(config) {
    const qualityChanged = normalizeQuality(config.quality) !== normalizeQuality(this.config.quality);
    const lowEndChanged = (config.lowEndAuto !== false) !== (this.config.lowEndAuto !== false);
    this.config = { ...config };
    if (qualityChanged || lowEndChanged) this.applyQuality();
    this.syncEffects();
    if (this.glow) {
      this.glow.material.uniforms.uStrength.value = 0.55 + config.bloom * 0.55;
      this.glow.position.x = config.modelX * 2.2;
    }
    if (this.background.mode === 'scene') this.background.setFit(config.fit);
    this.applyTheme(config.theme);
    this._needsRepaint = true;
    this.wake();
  }

  applyTheme(id) {
    const { palette } = getTheme(id);
    if (this.glow) {
      this.glow.material.uniforms.uColorA.value.set(palette.glowA);
      this.glow.material.uniforms.uColorB.value.set(palette.glowB);
    }
    if (this.particles?.material?.uniforms) {
      this.particles.material.uniforms.uColorA.value.set(palette.particleA);
      this.particles.material.uniforms.uColorB.value.set(palette.particleB);
    }
    if (this.lights) {
      this.lights.rimA.color.set(palette.rimA);
      this.lights.rimB.color.set(palette.rimB);
    }
  }

  applyQuality() {
    const tier = QUALITY[normalizeQuality(this.config.quality)];
    this.quality = tier;
    this.fpsCap = resolveFpsCap({
      tierFps: tier.fps,
      lowEnd: this.gpuLowEnd,
      lowEndAuto: this.config.lowEndAuto !== false,
    });
    // Sampling is the only thing a quality tier changes. Do not clamp this to
    // window.devicePixelRatio: on a 1x display every tier would collapse to the
    // same buffer size, so "balanced"/"high" would only change the frame cap
    // and the picture would never actually get sharper.
    const dpr = Math.max(1, Number(tier.dpr) || 1);
    this.renderer.setPixelRatio(dpr);
    this.pixelRatio = dpr;
    this._needsRepaint = true;
    this.resize();
    this.wake();
  }

  /**
   * Bloom and particles belong to the procedural demo, not to a wallpaper and
   * not to a quality tier. Keeping them on their own switches means changing
   * the sampling tier never rebuilds a composer or a particle system, so the
   * picture does not jump or stutter while the user drags the setting.
   */
  syncEffects() {
    if (this.mode !== 'procedural') return;
    const wantPost = Number(this.config.bloom) > 0.005;
    if (wantPost) {
      this.ensurePost();
    } else if (this.post) {
      try {
        this.post.dispose();
      } catch {
        /* ignore */
      }
      this.post = null;
    }
    if (this.post) this.post.setBloom(this.config.bloom);

    const wantParticles = this.config.particles !== false;
    if (wantParticles) {
      // Density 0 is how a disabled particle layer is hidden. Re-enabling must
      // restore the already-created system instead of merely skipping creation.
      if (this.particles) this.particles.setDensity(1);
      else this.ensureParticles();
    } else if (this.particles) {
      this.particles.setDensity(0);
    }
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.post?.setSize(width, height);
    this.background.resize(this.camera, width, height);
    this.width = width;
    this.height = height;
    this._needsRepaint = true;
    this.wake();
  }

  /* ---------------------------------------------------------------- */
  /* Loop                                                             */
  /* ---------------------------------------------------------------- */

  start() {
    if (this._running) return;
    this._running = true;
    this._last = 0;
    this._lastRender = 0;
    this._schedule();
  }

  _schedule() {
    if (!this._running || this._raf || this._timer || this.disposed) return;
    const interval = 1000 / (this.fpsCap || this.quality.fps || 60);
    if (interval > 20) {
      const since = this._lastRender ? performance.now() - this._lastRender : interval;
      const wait = Math.max(4, interval - since);
      this._timer = setTimeout(() => {
        this._timer = 0;
        this._tick();
      }, wait);
    } else {
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this._tick();
      });
    }
  }

  _cancel() {
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._timer) clearTimeout(this._timer);
    this._raf = 0;
    this._timer = 0;
  }

  /** Redraw now, then go back to sleep when the frame is static again. */
  wake() {
    this._needsRepaint = true;
    if (this._running) this._schedule();
  }

  _tick() {
    if (this.disposed || !this._running) return;
    if (document.hidden) return;
    if (this.contextLost) return;

    const now = performance.now();
    const interval = 1000 / (this.fpsCap || this.quality.fps || 60);
    if (this._lastRender && now - this._lastRender < interval - 1.5) {
      this._schedule();
      return;
    }
    const rawDt = this._lastRender ? (now - this._lastRender) / 1000 : interval / 1000;
    this._lastRender = now;
    const dt = clamp(rawDt, 0.001, 0.05);

    this._render(dt);
    this._needsRepaint = false;
    this._sampleFps(rawDt);

    if (this._shouldContinue(now)) this._schedule();
  }

  /**
   * A static image only changes when the pointer moves or the layout changes,
   * so there is no reason to burn a frame every 16ms. Video and scene
   * wallpapers keep animating and always continue.
   */
  _shouldContinue(now) {
    if (document.hidden) return false;
    // Always allow the first frame to paint even if the window is not focused
    // yet (embedded/injected pages can load in the background).
    if (!this.focused && this.config.pauseWhenUnfocused && !this._needsRepaint) return false;
    if (this.contextLost) return false;
    if (!this._needsRepaint && this.mode === 'artwork' && this.artworkKind === 'image' && this.config.idlePause) {
      return now - this._lastPointer < IDLE_PAUSE_MS;
    }
    return true;
  }

  _render(dt) {
    this.time += dt * Math.max(0.05, this.config.motion);
    this.mouse.lerp(this.targetMouse, 0.055);

    this.camera.position.x = this.mouse.x * 0.28 * this.config.parallax;
    this.camera.position.y = -this.mouse.y * 0.18 * this.config.parallax;
    this.camera.lookAt(0, 0, 0);

    this.background.update(this.time, this.mouse, this.config);

    if (this.mode === 'procedural') {
      if (this.model && this.modelEnabled) {
        this.model.update(dt, this.time, this.mouse, this.config);
      }
      if (this.particles && this.config.particles !== false) {
        this.particles.update(this.time, this.pixelRatio, this.config);
      }
      if (this.glow) {
        this.glow.material.uniforms.uTime.value = this.time;
        this.glow.position.y = this.config.modelY * 1.4;
      }
      if (this.lights) {
        this.lights.rimA.position.x = -6 + Math.sin(this.time * 0.35) * 1.2;
        this.lights.rimB.position.x = 6 + Math.cos(this.time * 0.28) * 1.2;
      }
    }

    if (this.post) {
      this.post.update(this.time, this.config);
      this.post.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  _sampleFps(rawDt) {
    this._fpsAcc += rawDt;
    this._fpsFrames += 1;
    if (this._fpsAcc < 0.5) return;
    this.fps = Math.round(this._fpsFrames / this._fpsAcc);
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this.onFps && this.onFps(this.fps);
  }

  stats() {
    const buffer = this.renderer?.getDrawingBufferSize?.(new THREE.Vector2());
    const textures = this.mode === 'procedural'
      ? []
      : this.background.sceneMaterial?.textures?.length
        ? this.background.sceneMaterial.textures
        : this.backgroundTexture
          ? [this.backgroundTexture]
          : [];
    const textureStats = summarizeTextures(textures);
    const memory = this.renderer?.info?.memory;
    const sceneMaterial = this.background?.sceneMaterial || null;
    const missingTextures = sceneMaterial?.missingTextures || [];
    const skippedEffects = sceneMaterial?.skippedEffects || [];
    return {
      fps: this.fps,
      tier: normalizeQuality(this.config.quality),
      fpsCap: this.fpsCap || this.quality.fps || 60,
      gpu: this.gpu,
      gpuLowEnd: this.gpuLowEnd,
      sceneMissingTextures: missingTextures.map((entry) => `${entry.role} · ${entry.name}`),
      sceneTextureWarnings: skippedEffects.map((entry) => `${entry.type} · ${entry.reason}`),
      dpr: this.pixelRatio || 1,
      bufferWidth: buffer?.x || 0,
      bufferHeight: buffer?.y || 0,
      cssWidth: this.width || 0,
      cssHeight: this.height || 0,
      mode: this.mode,
      artwork: this.artworkKind,
      antialias: Boolean(this.renderer.getContext()?.getContextAttributes?.()?.antialias),
      bloom: Boolean(this.post),
      particles: Boolean(this.particles && this.config.particles !== false),
      model: Boolean(this.model),
      drawCalls: this.renderer.info?.render?.calls ?? 0,
      geometries: memory?.geometries ?? 0,
      programs: this.renderer.info?.programs?.length ?? 0,
      triangles: this.renderer.info?.render?.triangles ?? 0,
      points: this.renderer.info?.render?.points ?? 0,
      maxTextureSize: this.renderer.capabilities?.maxTextureSize ?? 0,
      contextLost: this.contextLost,
      focused: this.focused,
      ...textureStats,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._running = false;
    this._cancel();
    window.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('visibilitychange', this._onVisibility);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('focus', this._onFocus);
    this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
    this._resizeObserver.disconnect();
    this.disposeBackgroundTexture();
    this.model?.dispose?.();
    this.particles?.dispose?.();
    this.post?.dispose?.();
    if (this.glow) {
      this.glow.geometry?.dispose();
      this.glow.material?.dispose();
      this.glow.parent?.remove(this.glow);
      this.glow = null;
    }
    if (this.lights) {
      Object.values(this.lights).forEach((light) => this.scene.remove(light));
      this.lights = null;
    }
    this.background.dispose();
    this.releaseEnvironment();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.scene.clear();
    this.canvas.remove();
  }
}
